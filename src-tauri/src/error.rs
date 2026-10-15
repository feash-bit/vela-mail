//! One error type for every command. It serialises to `{ code, message }` so the
//! UI can show a clear message and pick the right recovery (retry, sign in again…).
//! Messages never contain tokens or message content.

use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("You're offline or Google can't be reached. Vela will retry automatically.")]
    Offline,
    #[error("Your sign-in for {0} has expired. Sign in again to keep syncing.")]
    AuthExpired(String),
    #[error("Gmail is limiting requests right now. Vela will slow down and retry.")]
    RateLimited,
    #[error("Google OAuth client is not set up yet. Import your client file in Settings → Accounts.")]
    NoClientConfig,
    #[error("No system keyring is available. Vela stores sign-in tokens only in the keyring. {0}")]
    Keyring(String),
    #[error("Sign-in was cancelled.")]
    Cancelled,
    #[error("{0}")]
    NotFound(String),
    #[error("{0}")]
    Invalid(String),
    #[error("Gmail returned an error ({status}): {message}")]
    Api { status: u16, message: String },
    #[error("{0}")]
    Internal(String),
}

impl AppError {
    pub fn code(&self) -> &'static str {
        match self {
            AppError::Offline => "offline",
            AppError::AuthExpired(_) => "auth_expired",
            AppError::RateLimited => "rate_limited",
            AppError::NoClientConfig => "no_client_config",
            AppError::Keyring(_) => "keyring",
            AppError::Cancelled => "cancelled",
            AppError::NotFound(_) => "not_found",
            AppError::Invalid(_) => "invalid",
            AppError::Api { .. } => "api",
            AppError::Internal(_) => "internal",
        }
    }

    pub fn internal(e: impl std::fmt::Display) -> Self {
        AppError::Internal(e.to_string())
    }
}

#[derive(Serialize)]
struct WireError<'a> {
    code: &'a str,
    message: String,
}

impl Serialize for AppError {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        WireError { code: self.code(), message: self.to_string() }.serialize(s)
    }
}

impl From<rusqlite::Error> for AppError {
    fn from(e: rusqlite::Error) -> Self {
        AppError::Internal(format!("Local cache error: {e}"))
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        AppError::Internal(format!("File error: {e}"))
    }
}

impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        AppError::Internal(format!("Data format error: {e}"))
    }
}

impl From<reqwest::Error> for AppError {
    fn from(e: reqwest::Error) -> Self {
        if e.is_connect() || e.is_timeout() || e.is_request() {
            AppError::Offline
        } else {
            // reqwest errors can include the URL; strip it so query strings never leak.
            AppError::Internal(e.without_url().to_string())
        }
    }
}

pub type AppResult<T> = Result<T, AppError>;
