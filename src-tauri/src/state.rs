//! Shared application state handed to every command and background task.

use crate::auth::Auth;
use crate::cache::Cache;
use crate::config::{self, Settings, StoredAccount};
use crate::error::{AppError, AppResult};
use crate::gmail::Gmail;
use crate::models::{Identity, ReaderTarget, ThreadDetail};
use std::collections::{HashMap, VecDeque};
use std::path::PathBuf;
use std::sync::{Arc, Mutex, RwLock};
use tokio::sync::{Notify, Semaphore};

/// Max concurrent Gmail requests per account. Gmail allows 250 quota units
/// per user per second; 6 parallel requests keeps well under that.
const PER_ACCOUNT_CONCURRENCY: usize = 6;
const DETAIL_CACHE_SIZE: usize = 40;

pub struct PickedFile {
    pub path: PathBuf,
    pub filename: String,
    pub mime_type: String,
}

pub struct AppState {
    pub auth: Arc<Auth>,
    pub cache: Arc<Cache>,
    pub settings: RwLock<Settings>,
    pub accounts: RwLock<Vec<StoredAccount>>,
    pub sign_in_cancel: Arc<Notify>,
    pub sync_wake: Arc<Notify>,
    pub files: Mutex<HashMap<String, PickedFile>>,
    pub identities: Mutex<HashMap<String, Identity>>,
    pub pending_mailto: Mutex<Option<String>>,
    /// Pop-out reader windows: window label -> the email it shows.
    pub readers: Mutex<HashMap<String, ReaderTarget>>,
    /// Last size (logical pixels) of a pop-out window, used for the next one.
    pub reader_size: Mutex<(f64, f64)>,
    pub updater: crate::updater::UpdaterConfig,
    pub update_http: reqwest::Client,
    pub update: Mutex<crate::updater::UpdateStatus>,
    pub update_lock: tokio::sync::Mutex<()>,
    pub staged_update: Mutex<Option<PathBuf>>,
    limiters: Mutex<HashMap<String, Arc<Semaphore>>>,
    details: Mutex<VecDeque<(String, String, bool, ThreadDetail)>>,
}

impl AppState {
    pub fn new(auth: Arc<Auth>, cache: Arc<Cache>) -> Self {
        let updater_cfg = crate::updater::build_config();
        AppState {
            auth,
            cache,
            settings: RwLock::new(config::load_settings()),
            accounts: RwLock::new(config::load_accounts()),
            sign_in_cancel: Arc::new(Notify::new()),
            sync_wake: Arc::new(Notify::new()),
            files: Mutex::new(HashMap::new()),
            identities: Mutex::new(HashMap::new()),
            pending_mailto: Mutex::new(None),
            readers: Mutex::new(HashMap::new()),
            reader_size: Mutex::new(crate::reader_window::load_size()),
            update: Mutex::new(crate::updater::UpdateStatus::initial(updater_cfg.configured())),
            updater: updater_cfg,
            update_http: crate::updater::http_client(),
            update_lock: tokio::sync::Mutex::new(()),
            staged_update: Mutex::new(None),
            limiters: Mutex::new(HashMap::new()),
            details: Mutex::new(VecDeque::new()),
        }
    }

    pub fn account_ids(&self) -> Vec<String> {
        self.accounts.read().unwrap().iter().map(|a| a.email.clone()).collect()
    }

    /// A Gmail client for one of *our* accounts. Unknown IDs are rejected so
    /// the UI can never make Vela act on an arbitrary address.
    pub fn gmail(&self, account: &str) -> AppResult<Gmail> {
        if !self.accounts.read().unwrap().iter().any(|a| a.email == account) {
            return Err(AppError::NotFound("That account isn't signed in to Vela.".into()));
        }
        let limiter = self
            .limiters
            .lock()
            .unwrap()
            .entry(account.to_string())
            .or_insert_with(|| Arc::new(Semaphore::new(PER_ACCOUNT_CONCURRENCY)))
            .clone();
        Ok(Gmail::new(account, self.auth.clone(), limiter))
    }

    pub fn settings(&self) -> Settings {
        self.settings.read().unwrap().clone()
    }

    // ---- In-memory cache of opened threads (bodies never touch the disk) ----

    pub fn cached_detail(&self, account: &str, thread: &str, remote: bool) -> Option<ThreadDetail> {
        let d = self.details.lock().unwrap();
        d.iter().find(|(a, t, r, _)| a == account && t == thread && *r == remote).map(|x| x.3.clone())
    }

    pub fn store_detail(&self, account: &str, detail: ThreadDetail) {
        let mut d = self.details.lock().unwrap();
        d.retain(|(a, t, r, _)| !(a == account && *t == detail.id && *r == detail.remote_allowed));
        d.push_front((account.to_string(), detail.id.clone(), detail.remote_allowed, detail));
        d.truncate(DETAIL_CACHE_SIZE);
    }

    pub fn invalidate_details(&self, account: &str, threads: &[String]) {
        self.details.lock().unwrap().retain(|(a, t, _, _)| !(a == account && threads.contains(t)));
    }

    pub fn forget_account_memory(&self, account: &str) {
        self.details.lock().unwrap().retain(|(a, _, _, _)| a != account);
        self.identities.lock().unwrap().remove(account);
        self.limiters.lock().unwrap().remove(account);
        self.auth.forget(account);
    }
}
