//! App-side update flow: background checks, status events and the commands
//! the UI calls. The security-sensitive work lives in `updater.rs`.

use crate::error::{AppError, AppResult};
use crate::state::AppState;
use crate::sync::now_ms;
use crate::updater::{self, UpdateState, UpdateStatus};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

const FIRST_CHECK_DELAY: Duration = Duration::from_secs(20);
const CHECK_EVERY: Duration = Duration::from_secs(6 * 3600);

fn set(app: &AppHandle, f: impl FnOnce(&mut UpdateStatus)) -> UpdateStatus {
    let state = app.state::<AppState>();
    let snapshot = {
        let mut s = state.update.lock().unwrap();
        f(&mut s);
        s.clone()
    };
    let _ = app.emit("update://status", snapshot.clone());
    snapshot
}

pub fn status(app: &AppHandle) -> UpdateStatus {
    app.state::<AppState>().update.lock().unwrap().clone()
}

/// Look for a newer release. With `auto_download`, a newer release is
/// downloaded and verified straight away so it's ready on restart.
pub async fn check(app: &AppHandle, auto_download: bool) -> AppResult<UpdateStatus> {
    let state = app.state::<AppState>();
    if !state.updater.configured() {
        return Ok(status(app));
    }
    let _guard = state.update_lock.lock().await;
    // A verified update is already waiting: nothing more to do.
    if status(app).state == UpdateState::Ready {
        return Ok(status(app));
    }
    set(app, |s| {
        s.state = UpdateState::Checking;
        s.error = None;
    });
    let manifest = match updater::fetch_manifest(&state.update_http, &state.updater).await {
        Ok(m) => m,
        Err(AppError::NotFound(_)) => {
            return Ok(set(app, |s| {
                s.state = UpdateState::UpToDate;
                s.checked_at = Some(now_ms());
            }))
        }
        Err(e) => {
            let msg = e.to_string();
            set(app, |s| {
                s.state = UpdateState::Error;
                s.error = Some(msg);
                s.checked_at = Some(now_ms());
            });
            return Err(e);
        }
    };
    let current = env!("CARGO_PKG_VERSION");
    if !updater::is_newer(&manifest.version, current) {
        return Ok(set(app, |s| {
            s.state = UpdateState::UpToDate;
            s.checked_at = Some(now_ms());
            s.version = None;
        }));
    }
    let st = set(app, |s| {
        s.state = UpdateState::Available;
        s.version = Some(manifest.version.clone());
        s.notes = manifest.notes.clone();
        s.pub_date = manifest.pub_date.clone();
        s.checked_at = Some(now_ms());
    });
    if !(auto_download && st.can_install) {
        return Ok(st);
    }
    drop(_guard);
    download(app).await
}

pub async fn download(app: &AppHandle) -> AppResult<UpdateStatus> {
    let state = app.state::<AppState>();
    if !status(app).can_install {
        return Err(AppError::Invalid(
            "This copy of Vela was installed with pacman. Update it with makepkg instead (see README → Updating).".into(),
        ));
    }
    let _guard = state.update_lock.lock().await;
    if status(app).state == UpdateState::Ready {
        return Ok(status(app));
    }
    let manifest = updater::fetch_manifest(&state.update_http, &state.updater).await?;
    set(app, |s| {
        s.state = UpdateState::Downloading;
        s.progress = Some(0.0);
        s.version = Some(manifest.version.clone());
        s.notes = manifest.notes.clone();
    });
    let root = updater::staging_root();
    let _ = std::fs::remove_dir_all(&root);
    let app2 = app.clone();
    let mut last = 0.0;
    let result = updater::download_and_stage(&state.update_http, &state.updater, &manifest, env!("CARGO_PKG_VERSION"), &root, move |p| {
        // Throttle progress events to whole percentages.
        if p - last >= 0.01 || p >= 1.0 {
            last = p;
            set(&app2, |s| s.progress = Some(p));
        }
    })
    .await;
    match result {
        Ok(dir) => {
            *state.staged_update.lock().unwrap() = Some(dir);
            Ok(set(app, |s| {
                s.state = UpdateState::Ready;
                s.progress = None;
            }))
        }
        Err(e) => {
            let msg = e.to_string();
            set(app, |s| {
                s.state = UpdateState::Error;
                s.progress = None;
                s.error = Some(msg);
            });
            Err(e)
        }
    }
}

/// Swap in the verified binary and restart Vela.
pub fn install_and_restart(app: &AppHandle) -> AppResult<()> {
    let state = app.state::<AppState>();
    let staged = state
        .staged_update
        .lock()
        .unwrap()
        .clone()
        .ok_or_else(|| AppError::Invalid("No update is ready to install.".into()))?;
    let exe = std::env::current_exe()?;
    updater::install_staged(&staged, &exe)?;
    let _ = std::fs::remove_dir_all(updater::staging_root());
    log::info!("update installed, restarting");
    app.restart();
}

pub fn spawn(app: AppHandle) {
    let _ = std::fs::remove_dir_all(updater::staging_root());
    if !app.state::<AppState>().updater.configured() {
        return;
    }
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(FIRST_CHECK_DELAY).await;
        loop {
            if app.state::<AppState>().settings().auto_update {
                let _ = check(&app, true).await;
            }
            tokio::time::sleep(CHECK_EVERY).await;
        }
    });
}

// ---- Commands -----------------------------------------------------------------

#[tauri::command]
pub fn update_status(app: AppHandle) -> UpdateStatus {
    status(&app)
}

#[tauri::command]
pub async fn check_for_update(app: AppHandle, window: tauri::WebviewWindow) -> AppResult<UpdateStatus> {
    crate::commands::main_only(&window)?;
    let auto = app.state::<AppState>().settings().auto_update;
    check(&app, auto).await
}

#[tauri::command]
pub async fn download_update(app: AppHandle, window: tauri::WebviewWindow) -> AppResult<UpdateStatus> {
    crate::commands::main_only(&window)?;
    download(&app).await
}

#[tauri::command]
pub fn install_update(app: AppHandle, window: tauri::WebviewWindow) -> AppResult<()> {
    crate::commands::main_only(&window)?;
    install_and_restart(&app)
}
