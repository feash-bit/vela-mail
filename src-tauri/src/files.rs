//! Local files: attachments the user picks or drops, attachments being
//! opened or saved, and the private temp folder.
//!
//! The web view never handles file paths. It only receives opaque tokens for
//! files the user explicitly picked (file dialog or drag-and-drop), so a
//! compromised page could not attach and send an arbitrary file.

use crate::config;
use crate::error::{AppError, AppResult};
use crate::gmail::compose::MAX_ATTACHMENT_BYTES;
use crate::models::LocalFile;
use crate::oauth::random_b64;
use crate::state::{AppState, PickedFile};
use std::path::{Path, PathBuf};

/// Extensions that can run code when "opened". Vela will save these but not open them.
const RISKY: &[&str] = &[
    "desktop", "sh", "bash", "zsh", "fish", "csh", "run", "bin", "appimage", "exe", "msi", "bat", "cmd", "com", "scr",
    "pif", "jar", "py", "pyc", "pl", "rb", "php", "js", "mjs", "vbs", "vbe", "wsf", "ps1", "psm1", "lnk", "deb", "rpm",
    "apk", "flatpakref", "flatpak", "snap", "elf", "so", "ko", "out", "x86_64", "action", "command", "reg", "hta", "cpl",
];

pub fn is_risky(filename: &str) -> bool {
    let lower = filename.to_ascii_lowercase();
    let ext = Path::new(&lower).extension().and_then(|e| e.to_str()).unwrap_or("");
    ext.is_empty() || RISKY.contains(&ext) || lower.ends_with(".pkg.tar.zst") || lower.ends_with(".pkg.tar.xz")
}

/// Make an attachment name safe to use as a file name.
pub fn safe_filename(name: &str) -> String {
    let cleaned: String = name
        .chars()
        .map(|c| if c.is_control() || matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') { '_' } else { c })
        .collect();
    let trimmed = cleaned.trim().trim_start_matches('.').trim();
    let mut s: String = if trimmed.is_empty() { "attachment".into() } else { trimmed.to_string() };
    if s.len() > 180 {
        let ext = Path::new(&s).extension().and_then(|e| e.to_str()).map(|e| format!(".{e}")).unwrap_or_default();
        let mut cut = 180 - ext.len().min(20);
        while !s.is_char_boundary(cut) {
            cut -= 1;
        }
        s = format!("{}{}", &s[..cut], ext);
    }
    s
}

fn guess_mime(path: &Path) -> String {
    mime_guess::from_path(path).first_or_octet_stream().essence_str().to_string()
}

pub fn register_path(state: &AppState, path: &Path) -> AppResult<LocalFile> {
    let meta = std::fs::metadata(path)?;
    if !meta.is_file() {
        return Err(AppError::Invalid("Folders can't be attached. Attach the files inside instead.".into()));
    }
    let filename = path.file_name().and_then(|n| n.to_str()).map(safe_filename).unwrap_or_else(|| "attachment".into());
    if meta.len() > MAX_ATTACHMENT_BYTES {
        return Err(AppError::Invalid(format!("\"{filename}\" is larger than Gmail's 25 MB limit.")));
    }
    let token = random_b64(18);
    let mime_type = guess_mime(path);
    state.files.lock().unwrap().insert(
        token.clone(),
        PickedFile { path: path.to_path_buf(), filename: filename.clone(), mime_type: mime_type.clone() },
    );
    Ok(LocalFile { token, filename, size: meta.len(), mime_type })
}

/// A fresh private folder under ~/.cache/vela-mail/<kind>/<random>/
fn private_temp(kind: &str) -> AppResult<PathBuf> {
    let dir = config::cache_dir().join(kind).join(random_b64(9));
    config::ensure_private_dir(&dir)?;
    Ok(dir)
}

pub fn register_bytes(state: &AppState, filename: &str, mime: &str, data: &[u8]) -> AppResult<LocalFile> {
    let name = safe_filename(filename);
    let path = private_temp("drafts")?.join(&name);
    config::write_private(&path, data)?;
    let mut f = register_path(state, &path)?;
    f.mime_type = mime.to_string();
    if let Some(p) = state.files.lock().unwrap().get_mut(&f.token) {
        p.mime_type = mime.to_string();
    }
    Ok(f)
}

pub fn write_temp_attachment(filename: &str, data: &[u8]) -> AppResult<PathBuf> {
    let path = private_temp("attachments")?.join(safe_filename(filename));
    config::write_private(&path, data)?;
    Ok(path)
}

/// Remove temp files from previous sessions.
pub fn clean_temp() {
    for kind in ["attachments", "drafts"] {
        let _ = std::fs::remove_dir_all(config::cache_dir().join(kind));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filenames_cannot_escape_or_hide() {
        assert_eq!(safe_filename("../../etc/passwd"), "_.._etc_passwd");
        assert_eq!(safe_filename(".bashrc"), "bashrc");
        assert_eq!(safe_filename("  "), "attachment");
        assert_eq!(safe_filename("a\u{0}b\r\n.pdf"), "a_b__.pdf");
        assert!(safe_filename(&"é".repeat(300)).len() <= 182);
    }

    #[test]
    fn risky_types_are_flagged() {
        for f in ["run.sh", "Setup.EXE", "app.desktop", "tool.AppImage", "noext", "x.pkg.tar.zst"] {
            assert!(is_risky(f), "{f}");
        }
        for f in ["report.pdf", "photo.JPG", "notes.txt", "sheet.xlsx"] {
            assert!(!is_risky(f), "{f}");
        }
    }
}
