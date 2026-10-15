//! Access-token cache. Refresh tokens are read from the keyring on demand;
//! short-lived access tokens are kept in memory only and never sent to the UI.

use crate::config::{self, ClientConfig};
use crate::error::{AppError, AppResult};
use crate::models::AccountStatus;
use crate::{oauth, secrets};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

struct Cached {
    token: String,
    expires: Instant,
}

type StatusFn = Box<dyn Fn(&str, AccountStatus) + Send + Sync>;

pub struct Auth {
    pub http: reqwest::Client,
    tokens: Mutex<HashMap<String, Cached>>,
    locks: Mutex<HashMap<String, Arc<tokio::sync::Mutex<()>>>>,
    status: Mutex<HashMap<String, AccountStatus>>,
    on_status: StatusFn,
}

impl Auth {
    pub fn new(http: reqwest::Client, on_status: StatusFn) -> Self {
        Auth {
            http,
            tokens: Mutex::new(HashMap::new()),
            locks: Mutex::new(HashMap::new()),
            status: Mutex::new(HashMap::new()),
            on_status,
        }
    }

    pub fn status(&self, account: &str) -> AccountStatus {
        self.status.lock().unwrap().get(account).cloned().unwrap_or(AccountStatus::Ok)
    }

    pub fn set_status(&self, account: &str, s: AccountStatus) {
        let changed = self.status.lock().unwrap().insert(account.to_string(), s.clone()) != Some(s.clone());
        if changed {
            (self.on_status)(account, s);
        }
    }

    pub fn put(&self, account: &str, token: String, expires_in: u64) {
        let expires = Instant::now() + Duration::from_secs(expires_in.saturating_sub(60).max(30));
        self.tokens.lock().unwrap().insert(account.to_string(), Cached { token, expires });
        self.set_status(account, AccountStatus::Ok);
    }

    pub fn invalidate(&self, account: &str) {
        self.tokens.lock().unwrap().remove(account);
    }

    pub fn forget(&self, account: &str) {
        self.invalidate(account);
        self.status.lock().unwrap().remove(account);
    }

    fn cached(&self, account: &str) -> Option<String> {
        let map = self.tokens.lock().unwrap();
        map.get(account).filter(|c| c.expires > Instant::now()).map(|c| c.token.clone())
    }

    /// A valid access token, refreshing it (once, even under concurrency) when needed.
    pub async fn access_token(&self, account: &str) -> AppResult<String> {
        if let Some(t) = self.cached(account) {
            return Ok(t);
        }
        let lock = self.locks.lock().unwrap().entry(account.to_string()).or_default().clone();
        let _guard = lock.lock().await;
        if let Some(t) = self.cached(account) {
            return Ok(t);
        }
        if self.status(account) == AccountStatus::NeedsReauth {
            return Err(AppError::AuthExpired(account.to_string()));
        }
        let client: ClientConfig = config::load_client()?;
        let acct = account.to_string();
        let refresh = tokio::task::spawn_blocking(move || secrets::load_refresh_token(&acct))
            .await
            .map_err(AppError::internal)??;
        let Some(refresh) = refresh else {
            self.set_status(account, AccountStatus::NeedsReauth);
            return Err(AppError::AuthExpired(account.to_string()));
        };
        match oauth::refresh(&client, &self.http, &refresh, account).await {
            Ok(t) => {
                // Google may rotate refresh tokens; store the new one if given.
                if let Some(new_refresh) = t.refresh_token.clone() {
                    let acct = account.to_string();
                    let _ = tokio::task::spawn_blocking(move || secrets::store_refresh_token(&acct, &new_refresh)).await;
                }
                let token = t.access_token.clone();
                self.put(account, t.access_token, t.expires_in);
                Ok(token)
            }
            Err(AppError::AuthExpired(a)) => {
                self.set_status(account, AccountStatus::NeedsReauth);
                Err(AppError::AuthExpired(a))
            }
            Err(AppError::Offline) => {
                self.set_status(account, AccountStatus::Offline);
                Err(AppError::Offline)
            }
            Err(e) => Err(e),
        }
    }
}
