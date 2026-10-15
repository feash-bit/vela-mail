//! Paths, user settings, the Google OAuth client file and the account list.
//!
//! Nothing secret is stored here. Refresh tokens live only in the system keyring
//! (see `secrets.rs`). Every file Vela writes is created with owner-only
//! permissions (0600) inside owner-only folders (0700).

use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::Write;
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};

const APP_DIR: &str = "vela-mail";

fn home() -> PathBuf {
    std::env::var_os("HOME").map(PathBuf::from).unwrap_or_else(|| PathBuf::from("/tmp"))
}

fn xdg(var: &str, fallback: &str) -> PathBuf {
    match std::env::var_os(var) {
        Some(v) if Path::new(&v).is_absolute() => PathBuf::from(v),
        _ => home().join(fallback),
    }
}

/// ~/.config/vela-mail
pub fn config_dir() -> PathBuf {
    xdg("XDG_CONFIG_HOME", ".config").join(APP_DIR)
}
/// ~/.local/share/vela-mail
pub fn data_dir() -> PathBuf {
    xdg("XDG_DATA_HOME", ".local/share").join(APP_DIR)
}
/// ~/.cache/vela-mail
pub fn cache_dir() -> PathBuf {
    xdg("XDG_CACHE_HOME", ".cache").join(APP_DIR)
}

/// Create a folder (and parents) that only the current user can open.
pub fn ensure_private_dir(dir: &Path) -> AppResult<()> {
    if !dir.exists() {
        fs::DirBuilder::new().recursive(true).mode(0o700).create(dir)?;
    }
    fs::set_permissions(dir, fs::Permissions::from_mode(0o700))?;
    Ok(())
}

/// Atomically write a file readable only by the current user.
pub fn write_private(path: &Path, bytes: &[u8]) -> AppResult<()> {
    if let Some(parent) = path.parent() {
        ensure_private_dir(parent)?;
    }
    let tmp = path.with_extension("tmp");
    {
        let mut f = fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(0o600)
            .open(&tmp)?;
        f.write_all(bytes)?;
        f.sync_all()?;
    }
    fs::rename(&tmp, path)?;
    fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub theme: String,
    pub accent: String,
    pub density: String,
    pub sidebar_compact: bool,
    pub hidden_folders: Vec<String>,
    pub reader_layout: String,
    pub list_width: u32,
    pub show_snippets: bool,
    pub show_avatars: bool,
    pub notifications: bool,
    pub notify_inbox_only: bool,
    pub notification_preview: bool,
    pub sync_interval_secs: u32,
    pub block_remote_images: bool,
    pub trusted_senders: Vec<String>,
    pub mark_read_on_open: bool,
    pub undo_send_seconds: u32,
    pub confirm_discard: bool,
    pub launch_at_login: bool,
    pub start_minimized: bool,
    pub start_view: String,
    pub last_view: Option<String>,
    pub active_account: Option<String>,
    pub custom_title_bar: bool,
    pub reduced_motion: String,
    pub shortcuts: HashMap<String, String>,
    pub recent_searches: Vec<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Settings {
            theme: "dark".into(),
            accent: "#8b7bff".into(),
            density: "comfortable".into(),
            sidebar_compact: false,
            hidden_folders: vec![],
            reader_layout: "split".into(),
            list_width: 420,
            show_snippets: true,
            show_avatars: true,
            notifications: true,
            notify_inbox_only: true,
            notification_preview: false,
            sync_interval_secs: 60,
            block_remote_images: true,
            trusted_senders: vec![],
            mark_read_on_open: true,
            undo_send_seconds: 5,
            confirm_discard: true,
            launch_at_login: false,
            start_minimized: false,
            start_view: "inbox".into(),
            last_view: None,
            active_account: None,
            custom_title_bar: true,
            reduced_motion: "system".into(),
            shortcuts: HashMap::new(),
            recent_searches: vec![],
        }
    }
}

impl Settings {
    /// Keep values inside sensible ranges, whatever the UI (or a hand-edited file) sends.
    pub fn sanitized(mut self) -> Self {
        let pick = |v: &str, allowed: &[&str], d: &str| {
            if allowed.contains(&v) { v.to_string() } else { d.to_string() }
        };
        self.theme = pick(&self.theme, &["dark", "light", "system"], "dark");
        self.density = pick(&self.density, &["comfortable", "compact"], "comfortable");
        self.reader_layout = pick(&self.reader_layout, &["split", "full"], "split");
        self.start_view = pick(&self.start_view, &["inbox", "last"], "inbox");
        self.reduced_motion = pick(&self.reduced_motion, &["system", "on", "off"], "system");
        let hex_ok = self.accent.len() == 7
            && self.accent.starts_with('#')
            && self.accent[1..].chars().all(|c| c.is_ascii_hexdigit());
        if !hex_ok {
            self.accent = Settings::default().accent;
        }
        self.sync_interval_secs = self.sync_interval_secs.clamp(15, 3600);
        self.list_width = self.list_width.clamp(320, 720);
        self.undo_send_seconds = self.undo_send_seconds.min(30);
        self.recent_searches.truncate(12);
        self.trusted_senders.truncate(500);
        self
    }
}

fn settings_path() -> PathBuf {
    config_dir().join("settings.json")
}

pub fn load_settings() -> Settings {
    fs::read(settings_path())
        .ok()
        .and_then(|b| serde_json::from_slice::<Settings>(&b).ok())
        .unwrap_or_default()
        .sanitized()
}

pub fn save_settings(s: &Settings) -> AppResult<()> {
    write_private(&settings_path(), &serde_json::to_vec_pretty(s)?)
}

// ---------------------------------------------------------------------------
// Google OAuth client ("Desktop app" client downloaded from Google Cloud)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
pub struct ClientConfig {
    pub client_id: String,
    pub client_secret: String,
}

#[derive(Deserialize)]
struct ClientFile {
    installed: Option<ClientConfig>,
    web: Option<serde_json::Value>,
}

fn client_path() -> PathBuf {
    config_dir().join("google-client.json")
}

pub fn parse_client_file(bytes: &[u8]) -> AppResult<ClientConfig> {
    let file: ClientFile = serde_json::from_slice(bytes)
        .map_err(|_| AppError::Invalid("That file isn't a Google OAuth client file.".into()))?;
    match (file.installed, file.web) {
        (Some(c), _) if c.client_id.ends_with(".apps.googleusercontent.com") && !c.client_secret.is_empty() => Ok(c),
        (None, Some(_)) => Err(AppError::Invalid(
            "This is a \"Web application\" client. Create a \"Desktop app\" OAuth client instead.".into(),
        )),
        _ => Err(AppError::Invalid("The client file is missing a client ID or secret.".into())),
    }
}

pub fn load_client() -> AppResult<ClientConfig> {
    let bytes = fs::read(client_path()).map_err(|_| AppError::NoClientConfig)?;
    parse_client_file(&bytes)
}

pub fn has_client() -> bool {
    load_client().is_ok()
}

pub fn import_client(source: &Path) -> AppResult<()> {
    let meta = fs::metadata(source)?;
    if meta.len() > 64 * 1024 {
        return Err(AppError::Invalid("That file is too large to be an OAuth client file.".into()));
    }
    let bytes = fs::read(source)?;
    parse_client_file(&bytes)?;
    write_private(&client_path(), &bytes)
}

// ---------------------------------------------------------------------------
// Account list (email addresses and display names only)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredAccount {
    pub email: String,
    pub display_name: Option<String>,
    pub added_at: i64,
}

fn accounts_path() -> PathBuf {
    config_dir().join("accounts.json")
}

pub fn load_accounts() -> Vec<StoredAccount> {
    fs::read(accounts_path())
        .ok()
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or_default()
}

pub fn save_accounts(list: &[StoredAccount]) -> AppResult<()> {
    write_private(&accounts_path(), &serde_json::to_vec_pretty(list)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_web_clients_and_accepts_desktop() {
        let web = br#"{"web":{"client_id":"x.apps.googleusercontent.com","client_secret":"s"}}"#;
        assert!(parse_client_file(web).is_err());
        let ok = br#"{"installed":{"client_id":"123-abc.apps.googleusercontent.com","client_secret":"GOCSPX-x","redirect_uris":["http://localhost"]}}"#;
        assert_eq!(parse_client_file(ok).unwrap().client_secret, "GOCSPX-x");
        assert!(parse_client_file(b"not json").is_err());
    }

    #[test]
    fn settings_are_clamped() {
        let s = Settings { accent: "red; background:url(x)".into(), sync_interval_secs: 1, theme: "neon".into(), ..Default::default() }.sanitized();
        assert_eq!(s.accent, "#8b7bff");
        assert_eq!(s.sync_interval_secs, 15);
        assert_eq!(s.theme, "dark");
    }
}
