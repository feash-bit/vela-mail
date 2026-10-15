//! Refresh-token storage in the system keyring (freedesktop Secret Service:
//! KWallet on KDE Plasma, GNOME Keyring elsewhere).
//!
//! There is deliberately NO plaintext fallback. If no keyring is available the
//! user gets a clear error explaining how to enable one.

use crate::error::{AppError, AppResult};
use keyring::Entry;

const SERVICE: &str = "vela-mail";

fn entry(account: &str) -> AppResult<Entry> {
    Entry::new(SERVICE, &format!("gmail-refresh-token:{account}")).map_err(map_err)
}

fn map_err(e: keyring::Error) -> AppError {
    // Never include the secret itself; keyring errors don't contain it.
    let hint = "On KDE Plasma, open System Settings → KDE Wallet and make sure the wallet is enabled. \
                On other desktops install and unlock gnome-keyring.";
    match e {
        keyring::Error::NoStorageAccess(_) | keyring::Error::PlatformFailure(_) => AppError::Keyring(hint.into()),
        other => AppError::Keyring(format!("{other}. {hint}")),
    }
}

/// Blocking: call from `spawn_blocking`.
pub fn store_refresh_token(account: &str, token: &str) -> AppResult<()> {
    entry(account)?.set_password(token).map_err(map_err)
}

/// Blocking: call from `spawn_blocking`. `Ok(None)` means "not signed in".
pub fn load_refresh_token(account: &str) -> AppResult<Option<String>> {
    match entry(account)?.get_password() {
        Ok(t) => Ok(Some(t)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(map_err(e)),
    }
}

/// Blocking: call from `spawn_blocking`.
pub fn delete_refresh_token(account: &str) -> AppResult<()> {
    match entry(account)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(map_err(e)),
    }
}

/// Blocking: checks that a Secret Service provider answers.
pub fn keyring_available() -> bool {
    match Entry::new(SERVICE, "availability-probe") {
        Ok(e) => matches!(e.get_password(), Ok(_) | Err(keyring::Error::NoEntry)),
        Err(_) => false,
    }
}

#[cfg(test)]
mod tests {
    /// Needs a running Secret Service (run with `dbus-run-session` and an
    /// unlocked gnome-keyring or KWallet). Ignored in normal test runs.
    #[test]
    #[ignore]
    fn keyring_round_trip() {
        let acct = "keyring-test@example.com";
        assert!(super::keyring_available(), "no Secret Service provider");
        super::store_refresh_token(acct, "1//refresh-token-value").unwrap();
        assert_eq!(super::load_refresh_token(acct).unwrap().as_deref(), Some("1//refresh-token-value"));
        super::delete_refresh_token(acct).unwrap();
        assert_eq!(super::load_refresh_token(acct).unwrap(), None);
    }
}
