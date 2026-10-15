//! Self-updater for Vela installed in the user's home (~/.local/bin).
//!
//! Tauri's official updater only replaces AppImages, so Vela carries its own,
//! built on the same signing format: release archives are signed with
//! `tauri signer sign` (minisign, Ed25519) and verified here with the same
//! `minisign-verify` library Tauri uses.
//!
//! Safety rules, in order:
//! 1. Manifest and archive are fetched over HTTPS only (plain HTTP is allowed
//!    for 127.0.0.1/localhost so releases can be tested locally).
//! 2. The archive's signature is verified against the public key compiled
//!    into this build BEFORE anything is unpacked.
//! 3. The signed "trusted comment" must name this exact release file, and the
//!    VERSION file inside must match: an old signed release can't be replayed
//!    to downgrade Vela.
//! 4. Only newer versions are installed.
//! 5. Only an allow-list of files is unpacked, with size limits.
//! 6. The binary is swapped atomically (write beside it, then rename).

use crate::config;
use crate::error::{AppError, AppResult};
use crate::sync::now_ms;
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::io::Read;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::time::Duration;

pub const PLATFORM: &str = "linux-x86_64";
const MAX_MANIFEST: usize = 64 * 1024;
const MAX_ARCHIVE: u64 = 150 * 1024 * 1024;
const MAX_UNPACKED: u64 = 250 * 1024 * 1024;
/// Files a release archive may contain (inside a top-level `vela-mail/`).
const ALLOWED: &[&str] = &["VERSION", "vela-mail", "vela-mail.desktop", "vela-mail.svg", "README.txt"];

/// Where to look for updates and the key that signs them. Written by
/// `scripts/setup-updates.sh`; both values are public.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct UpdaterConfig {
    #[serde(default)]
    pub endpoint: String,
    #[serde(default)]
    pub pubkey: String,
}

pub fn build_config() -> UpdaterConfig {
    serde_json::from_str(include_str!("../updater.json")).unwrap_or_default()
}

impl UpdaterConfig {
    pub fn configured(&self) -> bool {
        !self.endpoint.trim().is_empty() && !self.pubkey.trim().is_empty()
    }
}

// ---------------------------------------------------------------------------
// Status shared with the UI
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum InstallKind {
    /// ~/.local/bin (scripts/install.sh): Vela can update itself.
    User,
    /// /usr or /opt (pacman / makepkg): update with makepkg instead.
    System,
    /// Running from a build folder (development).
    Dev,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum UpdateState {
    NotConfigured,
    Idle,
    Checking,
    UpToDate,
    Available,
    Downloading,
    Ready,
    Error,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateStatus {
    pub state: UpdateState,
    pub current: String,
    pub version: Option<String>,
    pub notes: Option<String>,
    pub pub_date: Option<String>,
    pub progress: Option<f64>,
    pub install_kind: InstallKind,
    pub can_install: bool,
    pub error: Option<String>,
    pub checked_at: Option<i64>,
}

impl UpdateStatus {
    pub fn initial(configured: bool) -> Self {
        let kind = install_kind();
        UpdateStatus {
            state: if configured { UpdateState::Idle } else { UpdateState::NotConfigured },
            current: env!("CARGO_PKG_VERSION").to_string(),
            version: None,
            notes: None,
            pub_date: None,
            progress: None,
            can_install: kind == InstallKind::User,
            install_kind: kind,
            error: None,
            checked_at: None,
        }
    }
}

pub fn install_kind() -> InstallKind {
    let exe = std::env::current_exe().unwrap_or_default();
    classify(&exe, &std::env::var("HOME").unwrap_or_default())
}

fn classify(exe: &Path, home: &str) -> InstallKind {
    let s = exe.to_string_lossy();
    if s.contains("/target/debug/") || s.contains("/target/release/") || s.contains("/src-tauri/") {
        InstallKind::Dev
    } else if !home.is_empty() && exe.starts_with(home) {
        InstallKind::User
    } else {
        InstallKind::System
    }
}

// ---------------------------------------------------------------------------
// Manifest (Tauri-compatible latest.json, plus an optional sha256)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Deserialize)]
pub struct Manifest {
    pub version: String,
    #[serde(default)]
    pub notes: Option<String>,
    #[serde(default)]
    pub pub_date: Option<String>,
    pub platforms: std::collections::HashMap<String, PlatformEntry>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct PlatformEntry {
    pub url: String,
    pub signature: String,
    #[serde(default)]
    pub sha256: Option<String>,
}

pub fn archive_name(version: &str) -> String {
    format!("vela-mail-{version}-{PLATFORM}.tar.gz")
}

/// HTTPS everywhere; plain HTTP only to this machine (for local release tests).
pub fn url_allowed(u: &url::Url) -> bool {
    match u.scheme() {
        "https" => true,
        "http" => matches!(u.host_str(), Some("127.0.0.1") | Some("localhost") | Some("[::1]")),
        _ => false,
    }
}

pub fn http_client() -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent(concat!("Vela-Updater/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(600))
        // Follow redirects (GitHub sends downloads to its CDN) but never to plain HTTP.
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() > 5 || !url_allowed(attempt.url()) {
                attempt.stop()
            } else {
                attempt.follow()
            }
        }))
        .build()
        .expect("updater HTTP client")
}

fn parse_url(s: &str) -> AppResult<url::Url> {
    let u = url::Url::parse(s.trim()).map_err(|_| AppError::Invalid("The update address isn't valid.".into()))?;
    if !url_allowed(&u) {
        return Err(AppError::Invalid("Updates must be downloaded over HTTPS.".into()));
    }
    Ok(u)
}

pub fn is_newer(candidate: &str, current: &str) -> bool {
    match (semver::Version::parse(candidate.trim_start_matches('v')), semver::Version::parse(current)) {
        (Ok(a), Ok(b)) => a > b,
        _ => false,
    }
}

pub async fn fetch_manifest(http: &reqwest::Client, cfg: &UpdaterConfig) -> AppResult<Manifest> {
    let u = parse_url(&cfg.endpoint)?;
    let resp = http.get(u).header("Cache-Control", "no-cache").send().await?;
    if resp.status().as_u16() == 404 {
        return Err(AppError::NotFound("No release has been published yet.".into()));
    }
    if !resp.status().is_success() {
        return Err(AppError::Api { status: resp.status().as_u16(), message: "The update server returned an error.".into() });
    }
    let bytes = read_limited(resp, MAX_MANIFEST as u64, |_| {}).await?;
    serde_json::from_slice(&bytes).map_err(|_| AppError::Invalid("The update information couldn't be read.".into()))
}

async fn read_limited(resp: reqwest::Response, max: u64, mut progress: impl FnMut(u64)) -> AppResult<Vec<u8>> {
    if resp.content_length().is_some_and(|n| n > max) {
        return Err(AppError::Invalid("The update download is larger than expected.".into()));
    }
    let mut out = Vec::new();
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        if out.len() as u64 + chunk.len() as u64 > max {
            return Err(AppError::Invalid("The update download is larger than expected.".into()));
        }
        out.extend_from_slice(&chunk);
        progress(out.len() as u64);
    }
    Ok(out)
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

/// Verify a Tauri/minisign signature (both values base64 as produced by
/// `tauri signer`) and return the signed trusted comment.
pub fn verify_signature(pubkey_b64: &str, signature_b64: &str, data: &[u8]) -> AppResult<String> {
    let bad = |what: &str| AppError::Invalid(format!("Update rejected: {what}. Vela won't install it."));
    let pk_text = String::from_utf8(STANDARD.decode(pubkey_b64.trim()).map_err(|_| bad("the built-in update key is damaged"))?)
        .map_err(|_| bad("the built-in update key is damaged"))?;
    let sig_text = String::from_utf8(STANDARD.decode(signature_b64.trim()).map_err(|_| bad("its signature is malformed"))?)
        .map_err(|_| bad("its signature is malformed"))?;
    let pk = minisign_verify::PublicKey::decode(&pk_text).map_err(|_| bad("the built-in update key is damaged"))?;
    let sig = minisign_verify::Signature::decode(&sig_text).map_err(|_| bad("its signature is malformed"))?;
    pk.verify(data, &sig, true).map_err(|_| bad("its signature doesn't match the Vela release key"))?;
    Ok(sig.trusted_comment().to_string())
}

/// The trusted comment (signed) must name exactly this release's file.
fn check_trusted_comment(comment: &str, version: &str) -> AppResult<()> {
    let expected = archive_name(version);
    let file = comment.split('\t').find_map(|part| part.strip_prefix("file:")).unwrap_or("");
    if file != expected {
        return Err(AppError::Invalid(format!(
            "Update rejected: it was signed as \"{file}\", not \"{expected}\". Vela won't install it."
        )));
    }
    Ok(())
}

/// Unpack only allow-listed files into `dest`. Returns the VERSION it contains.
pub fn unpack(archive: &[u8], dest: &Path) -> AppResult<String> {
    config::ensure_private_dir(dest)?;
    let gz = flate2::read::GzDecoder::new(archive);
    let mut tar = tar::Archive::new(gz);
    let mut total = 0u64;
    let mut found = std::collections::HashSet::new();
    for entry in tar.entries().map_err(|_| AppError::Invalid("The update archive is damaged.".into()))? {
        let mut entry = entry.map_err(|_| AppError::Invalid("The update archive is damaged.".into()))?;
        let path = entry.path().map_err(|_| AppError::Invalid("The update archive is damaged.".into()))?.into_owned();
        let kind = entry.header().entry_type();
        if kind.is_dir() {
            continue;
        }
        let rel = path.strip_prefix("vela-mail").unwrap_or(&path);
        let name = rel.to_string_lossy().to_string();
        if !kind.is_file() || !ALLOWED.contains(&name.as_str()) || rel.components().count() != 1 {
            return Err(AppError::Invalid(format!("Update rejected: unexpected file \"{}\" in the archive.", path.display())));
        }
        total += entry.size();
        if total > MAX_UNPACKED {
            return Err(AppError::Invalid("Update rejected: the archive unpacks to more than expected.".into()));
        }
        let mut data = Vec::with_capacity(entry.size() as usize);
        entry.read_to_end(&mut data).map_err(|_| AppError::Invalid("The update archive is damaged.".into()))?;
        config::write_private(&dest.join(&name), &data)?;
        found.insert(name);
    }
    for required in ["VERSION", "vela-mail"] {
        if !found.contains(required) {
            return Err(AppError::Invalid(format!("Update rejected: the archive has no {required}.")));
        }
    }
    let version = std::fs::read_to_string(dest.join("VERSION"))?.trim().to_string();
    std::fs::set_permissions(dest.join("vela-mail"), std::fs::Permissions::from_mode(0o755))?;
    Ok(version)
}

/// Download, verify and unpack a release. Returns the staging folder.
pub async fn download_and_stage(
    http: &reqwest::Client,
    cfg: &UpdaterConfig,
    manifest: &Manifest,
    current: &str,
    staging_root: &Path,
    progress: impl FnMut(f64),
) -> AppResult<PathBuf> {
    if !is_newer(&manifest.version, current) {
        return Err(AppError::Invalid("That release isn't newer than the one you have.".into()));
    }
    let entry = manifest
        .platforms
        .get(PLATFORM)
        .ok_or_else(|| AppError::NotFound("This release has no Linux build.".into()))?;
    let resp = http.get(parse_url(&entry.url)?).send().await?;
    if !resp.status().is_success() {
        return Err(AppError::Api { status: resp.status().as_u16(), message: "The update download failed.".into() });
    }
    let total = resp.content_length().unwrap_or(0) as f64;
    let mut progress = progress;
    let bytes = read_limited(resp, MAX_ARCHIVE, |n| {
        if total > 0.0 {
            progress((n as f64 / total).min(1.0));
        }
    })
    .await?;
    verify_and_unpack(cfg, manifest, &bytes, staging_root)
}

/// Everything after the download: signature, signed file name, checksum,
/// allow-listed unpacking and the version cross-check.
pub fn verify_and_unpack(cfg: &UpdaterConfig, manifest: &Manifest, bytes: &[u8], staging_root: &Path) -> AppResult<PathBuf> {
    let entry = manifest
        .platforms
        .get(PLATFORM)
        .ok_or_else(|| AppError::NotFound("This release has no Linux build.".into()))?;
    // 1. Signature over the exact bytes, with the key built into this app.
    let comment = verify_signature(&cfg.pubkey, &entry.signature, bytes)?;
    // 2. The signed comment names this version's file (no replay of old releases).
    check_trusted_comment(&comment, &manifest.version)?;
    // 3. Optional checksum from the manifest.
    if let Some(expected) = &entry.sha256 {
        let actual: String = Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect();
        if !expected.eq_ignore_ascii_case(&actual) {
            return Err(AppError::Invalid("Update rejected: checksum mismatch.".into()));
        }
    }
    // 4. Unpack (allow-list only) and cross-check the version inside.
    let dest = staging_root.join(format!("{}-{}", manifest.version, now_ms()));
    let _ = std::fs::remove_dir_all(&dest);
    let inner = unpack(bytes, &dest)?;
    if inner != manifest.version {
        let _ = std::fs::remove_dir_all(&dest);
        return Err(AppError::Invalid("Update rejected: the version inside doesn't match the release.".into()));
    }
    Ok(dest)
}

/// Replace the running binary with the staged one (atomic rename).
pub fn install_staged(staged: &Path, exe: &Path) -> AppResult<()> {
    let dir = exe.parent().ok_or_else(|| AppError::internal("no install folder"))?;
    let tmp = dir.join(".vela-mail.update");
    std::fs::copy(staged.join("vela-mail"), &tmp).map_err(|e| AppError::Invalid(format!("Couldn't write the new version: {e}")))?;
    std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(0o755))?;
    std::fs::File::open(&tmp)?.sync_all()?;
    std::fs::rename(&tmp, exe).map_err(|e| {
        let _ = std::fs::remove_file(&tmp);
        AppError::Invalid(format!("Couldn't replace Vela: {e}"))
    })?;

    // Best effort: refresh the menu entry and icon installed by install.sh.
    let data = std::env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(std::env::var("HOME").unwrap_or_default()).join(".local/share"));
    let desktop = data.join("applications/vela-mail.desktop");
    if desktop.exists() && staged.join("vela-mail.desktop").exists() {
        let _ = std::fs::copy(staged.join("vela-mail.desktop"), &desktop);
    }
    if staged.join("vela-mail.svg").exists() {
        let icon = data.join("icons/hicolor/scalable/apps/vela-mail.svg");
        if let Some(p) = icon.parent() {
            let _ = std::fs::create_dir_all(p);
        }
        let _ = std::fs::copy(staged.join("vela-mail.svg"), icon);
    }
    Ok(())
}

pub fn staging_root() -> PathBuf {
    config::data_dir().join("updates")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_comparison() {
        assert!(is_newer("0.2.0", "0.1.0"));
        assert!(is_newer("v0.1.1", "0.1.0"));
        assert!(!is_newer("0.1.0", "0.1.0"));
        assert!(!is_newer("0.0.9", "0.1.0"));
        assert!(!is_newer("not-a-version", "0.1.0"));
        assert!(is_newer("0.2.0", "0.2.0-beta.1"));
    }

    #[test]
    fn only_https_or_loopback() {
        let ok = |s: &str| url_allowed(&url::Url::parse(s).unwrap());
        assert!(ok("https://github.com/x/y/releases/latest/download/latest.json"));
        assert!(ok("http://127.0.0.1:8765/latest.json"));
        assert!(!ok("http://example.com/latest.json"));
        assert!(!ok("file:///etc/passwd"));
    }

    #[test]
    fn classifies_install_locations() {
        assert_eq!(classify(Path::new("/home/stu/.local/bin/vela-mail"), "/home/stu"), InstallKind::User);
        assert_eq!(classify(Path::new("/usr/bin/vela-mail"), "/home/stu"), InstallKind::System);
        assert_eq!(classify(Path::new("/home/stu/vela/src-tauri/target/release/vela-mail"), "/home/stu"), InstallKind::Dev);
    }

    #[test]
    fn trusted_comment_must_name_this_release() {
        assert!(check_trusted_comment("timestamp:1\tfile:vela-mail-0.2.0-linux-x86_64.tar.gz", "0.2.0").is_ok());
        assert!(check_trusted_comment("timestamp:1\tfile:vela-mail-0.1.5-linux-x86_64.tar.gz", "0.2.0").is_err());
        assert!(check_trusted_comment("timestamp:1", "0.2.0").is_err());
    }

    fn tarball(files: &[(&str, &[u8])]) -> Vec<u8> {
        let mut b = tar::Builder::new(flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast()));
        for (name, data) in files {
            let mut h = tar::Header::new_gnu();
            h.set_size(data.len() as u64);
            h.set_mode(0o644);
            h.set_entry_type(tar::EntryType::Regular);
            h.set_cksum();
            b.append_data(&mut h, name, *data).unwrap();
        }
        b.into_inner().unwrap().finish().unwrap()
    }

    #[test]
    fn unpacks_allowed_files_only() {
        let dir = tempfile::tempdir().unwrap();
        let ok = tarball(&[("vela-mail/VERSION", b"0.2.0\n"), ("vela-mail/vela-mail", b"\x7fELF")]);
        assert_eq!(unpack(&ok, &dir.path().join("a")).unwrap(), "0.2.0");
        let mode = std::fs::metadata(dir.path().join("a/vela-mail")).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o755);

        let extra = tarball(&[("vela-mail/VERSION", b"0.2.0"), ("vela-mail/vela-mail", b"x"), ("vela-mail/evil.sh", b"rm -rf ~")]);
        assert!(unpack(&extra, &dir.path().join("b")).is_err());
        let nested = tarball(&[("vela-mail/VERSION", b"0.2.0"), ("vela-mail/sub/vela-mail", b"x")]);
        assert!(unpack(&nested, &dir.path().join("c")).is_err());
        let missing = tarball(&[("vela-mail/VERSION", b"0.2.0")]);
        assert!(unpack(&missing, &dir.path().join("d")).is_err());
        assert!(unpack(b"not a tarball", &dir.path().join("e")).is_err());
    }

    #[test]
    fn rejects_traversal_in_raw_tar_headers() {
        // tar::Builder refuses "..", so craft the header by hand.
        let mut h = tar::Header::new_old();
        h.as_old_mut().name[..16].copy_from_slice(b"../../.bashrc\0\0\0");
        h.set_size(1);
        h.set_entry_type(tar::EntryType::Regular);
        h.set_cksum();
        let mut raw = h.as_bytes().to_vec();
        raw.extend_from_slice(b"x");
        raw.resize(raw.len() + 511, 0);
        raw.extend_from_slice(&[0u8; 1024]);
        let mut gz = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
        std::io::Write::write_all(&mut gz, &raw).unwrap();
        let dir = tempfile::tempdir().unwrap();
        assert!(unpack(&gz.finish().unwrap(), &dir.path().join("x")).is_err());
        assert!(!dir.path().join(".bashrc").exists());
    }

    #[test]
    fn install_swaps_binary_atomically() {
        let dir = tempfile::tempdir().unwrap();
        let staged = dir.path().join("staged");
        std::fs::create_dir_all(&staged).unwrap();
        std::fs::write(staged.join("vela-mail"), b"new").unwrap();
        let exe = dir.path().join("bin/vela-mail");
        std::fs::create_dir_all(exe.parent().unwrap()).unwrap();
        std::fs::write(&exe, b"old").unwrap();
        install_staged(&staged, &exe).unwrap();
        assert_eq!(std::fs::read(&exe).unwrap(), b"new");
        assert!(!dir.path().join("bin/.vela-mail.update").exists());
    }
}
