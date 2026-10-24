//! Pop-out reader windows: one real OS window per opened email.
//!
//! A window's label is derived from the email it shows, so opening the same
//! email twice focuses the existing window. The window learns which email it
//! shows by asking `reader_target` (nothing about the email is in its URL).
//!
//! Only the window *size* is remembered. Position is not: on KDE Wayland the
//! compositor places new windows and applications can't override that.

use crate::config;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const LABEL_PREFIX: &str = "reader-";

const DEFAULT_SIZE: (f64, f64) = (920.0, 780.0);
const MIN_WIDTH: f64 = 480.0;
const MIN_HEIGHT: f64 = 400.0;
const MAX_SIZE: f64 = 4000.0;

pub fn is_reader(label: &str) -> bool {
    label.starts_with(LABEL_PREFIX)
}

/// Same email, same label. Hashing keeps the label inside Tauri's allowed
/// characters whatever the account or thread ID contains.
pub fn label_for(account: &str, thread: &str) -> String {
    let digest = Sha256::digest(format!("{account}\n{thread}").as_bytes());
    let hex: String = digest.iter().take(8).map(|b| format!("{b:02x}")).collect();
    format!("{LABEL_PREFIX}{hex}")
}

/// Gmail thread IDs are short hex strings; refuse anything else.
pub fn valid_thread_id(id: &str) -> bool {
    (1..=64).contains(&id.len()) && id.chars().all(|c| c.is_ascii_alphanumeric())
}

pub fn clamp_size(w: f64, h: f64) -> (f64, f64) {
    if !w.is_finite() || !h.is_finite() {
        return DEFAULT_SIZE;
    }
    (w.clamp(MIN_WIDTH, MAX_SIZE), h.clamp(MIN_HEIGHT, MAX_SIZE))
}

#[derive(Serialize, Deserialize)]
struct StoredSize {
    width: f64,
    height: f64,
}

fn size_path() -> std::path::PathBuf {
    config::config_dir().join("reader-window.json")
}

pub fn load_size() -> (f64, f64) {
    std::fs::read(size_path())
        .ok()
        .and_then(|b| serde_json::from_slice::<StoredSize>(&b).ok())
        .map(|s| clamp_size(s.width, s.height))
        .unwrap_or(DEFAULT_SIZE)
}

pub fn save_size(w: f64, h: f64) {
    let (width, height) = clamp_size(w, h);
    let result = config::ensure_private_dir(&config::config_dir())
        .and_then(|_| Ok(serde_json::to_vec(&StoredSize { width, height })?))
        .and_then(|bytes| config::write_private(&size_path(), &bytes));
    if let Err(e) = result {
        log::warn!("couldn't remember the pop-out window size: {e}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn labels_are_deterministic_and_valid() {
        let a = label_for("me@example.com", "18c2f0a1b2c3d4e5");
        assert_eq!(a, label_for("me@example.com", "18c2f0a1b2c3d4e5"));
        assert!(a.starts_with(LABEL_PREFIX));
        assert!(is_reader(&a));
        assert!(a.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-'));
        assert_eq!(a.len(), LABEL_PREFIX.len() + 16);
    }

    #[test]
    fn labels_differ_per_account_and_thread() {
        let base = label_for("me@example.com", "abc");
        assert_ne!(base, label_for("you@example.com", "abc"));
        assert_ne!(base, label_for("me@example.com", "abd"));
        // The separator stops ("a", "bc") and ("ab", "c") colliding.
        assert_ne!(label_for("a", "bc"), label_for("ab", "c"));
    }

    #[test]
    fn only_reader_labels_are_readers() {
        assert!(!is_reader("main"));
        assert!(!is_reader("reader"));
        assert!(is_reader("reader-0123"));
    }

    #[test]
    fn thread_ids_are_checked() {
        assert!(valid_thread_id("18c2f0a1b2c3d4e5"));
        assert!(valid_thread_id(&"a".repeat(64)));
        assert!(!valid_thread_id(""));
        assert!(!valid_thread_id(&"a".repeat(65)));
        assert!(!valid_thread_id("../x"));
        assert!(!valid_thread_id("a b"));
        assert!(!valid_thread_id("é"));
    }

    #[test]
    fn sizes_are_clamped() {
        assert_eq!(clamp_size(920.0, 780.0), (920.0, 780.0));
        assert_eq!(clamp_size(100.0, 100.0), (MIN_WIDTH, MIN_HEIGHT));
        assert_eq!(clamp_size(99999.0, 99999.0), (MAX_SIZE, MAX_SIZE));
        assert_eq!(clamp_size(f64::NAN, 600.0), DEFAULT_SIZE);
        assert_eq!(clamp_size(600.0, f64::INFINITY), DEFAULT_SIZE);
        assert_eq!(clamp_size(f64::NEG_INFINITY, f64::NAN), DEFAULT_SIZE);
    }
}
