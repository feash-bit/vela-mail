//! Background synchronisation.
//!
//! The first run only records Gmail's current `historyId`. After that, each
//! cycle asks `users.history.list` for what changed since the last checkpoint
//! and re-fetches just those threads — no repeated full downloads. If the
//! checkpoint is too old (Gmail returns 404), Vela takes a fresh checkpoint
//! and tells the UI to reload the current view.

use crate::error::{AppError, AppResult};
use crate::mail;
use crate::models::{MailChanged, SyncState};
use crate::notify;
use crate::state::AppState;
use std::collections::BTreeSet;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

pub fn now_ms() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

pub fn spawn(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        // Let the window paint first.
        tokio::time::sleep(Duration::from_secs(2)).await;
        loop {
            let state = app.state::<AppState>();
            for account in state.account_ids() {
                run_once(&app, &account).await;
            }
            process_snoozes(&app).await;
            let interval = state.settings().sync_interval_secs as u64;
            let wake = state.sync_wake.clone();
            tokio::select! {
                _ = tokio::time::sleep(Duration::from_secs(interval)) => {},
                _ = wake.notified() => {},
            }
        }
    });
}

pub async fn run_once(app: &AppHandle, account: &str) {
    let state = app.state::<AppState>();
    let emit_state = |syncing: bool, err: Option<&AppError>| {
        let _ = app.emit(
            "sync://state",
            SyncState {
                account_id: account.to_string(),
                syncing,
                last_sync: state.cache.last_sync(account).ok().flatten(),
                error: err.map(|e| e.to_string()),
                error_code: err.map(|e| e.code().to_string()),
            },
        );
    };
    emit_state(true, None);
    let result = sync_account(app, &state, account).await;
    if let Err(e) = &result {
        log::info!("sync for one account failed: {}", e.code());
    }
    emit_state(false, result.as_ref().err());
}

async fn sync_account(app: &AppHandle, state: &AppState, account: &str) -> AppResult<()> {
    let g = state.gmail(account)?;
    let Some(start) = state.cache.history_id(account)? else {
        let p = g.profile().await?;
        state.cache.set_history_id(account, &p.history_id, now_ms())?;
        return Ok(());
    };

    let changes = match collect_changes(&g, &start).await {
        Ok(c) => c,
        Err(AppError::NotFound(_)) => {
            // Checkpoint expired: take a new one and ask the UI to reload.
            let p = g.profile().await?;
            state.cache.set_history_id(account, &p.history_id, now_ms())?;
            let _ = app.emit("mail://changed", MailChanged { account_id: account.into(), thread_ids: vec![], labels_changed: true, full_refresh: true });
            return Ok(());
        }
        Err(e) => return Err(e),
    };
    let Changes { changed, new_inbox_threads, labels_changed, latest } = changes;

    if !changed.is_empty() {
        let ids: Vec<String> = changed.into_iter().collect();
        state.invalidate_details(account, &ids);
        let (summaries, _gone) = mail::summaries(state, &g, ids.clone()).await?;
        let _ = app.emit("mail://changed", MailChanged { account_id: account.into(), thread_ids: ids, labels_changed, full_refresh: false });

        let settings = state.settings();
        let focused = app.get_webview_window("main").and_then(|w| w.is_focused().ok()).unwrap_or(false);
        if settings.notifications && !focused {
            let fresh: Vec<_> = summaries
                .into_iter()
                .filter(|s| new_inbox_threads.contains(&s.id))
                .filter(|s| !settings.notify_inbox_only || s.label_ids.iter().any(|l| l == "INBOX"))
                .collect();
            notify::new_mail(app, account, &fresh, settings.notification_preview);
        }
    }
    state.cache.set_history_id(account, &latest, now_ms())?;
    Ok(())
}

#[derive(Debug, Default)]
pub struct Changes {
    pub changed: BTreeSet<String>,
    pub new_inbox_threads: BTreeSet<String>,
    pub labels_changed: bool,
    pub latest: String,
}

/// Walk every page of `users.history.list` since `start` and summarise what
/// changed. A 404 (checkpoint too old) is returned as `NotFound`.
pub async fn collect_changes(g: &crate::gmail::Gmail, start: &str) -> AppResult<Changes> {
    let mut c = Changes { latest: start.to_string(), ..Default::default() };
    let mut page: Option<String> = None;
    loop {
        let h = g.history(start, page.as_deref()).await?;
        for item in &h.history {
            for m in &item.messages {
                c.changed.insert(m.thread_id.clone());
            }
            for w in &item.messages_added {
                c.changed.insert(w.message.thread_id.clone());
                c.labels_changed = true;
                let l = &w.message.label_ids;
                let has = |x: &str| l.iter().any(|y| y == x);
                if has("INBOX") && has("UNREAD") && !has("SENT") && !has("DRAFT") {
                    c.new_inbox_threads.insert(w.message.thread_id.clone());
                }
            }
            for w in &item.messages_deleted {
                c.changed.insert(w.message.thread_id.clone());
                c.labels_changed = true;
            }
            for ch in item.labels_added.iter().chain(item.labels_removed.iter()) {
                c.changed.insert(ch.message.thread_id.clone());
                c.labels_changed = true;
            }
        }
        if let Some(id) = h.history_id {
            c.latest = id;
        }
        page = h.next_page_token;
        if page.is_none() {
            break;
        }
    }
    c.changed.remove("");
    Ok(c)
}

/// Return snoozed threads to the inbox when their time comes.
async fn process_snoozes(app: &AppHandle) {
    let state = app.state::<AppState>();
    let Ok(due) = state.cache.due_snoozes(now_ms()) else { return };
    for (account, thread) in due {
        let Ok(g) = state.gmail(&account) else {
            let _ = state.cache.clear_snooze(&account, &thread);
            continue;
        };
        match g.modify_thread(&thread, &["INBOX".into(), "UNREAD".into()], &[]).await {
            Ok(()) | Err(AppError::NotFound(_)) => {
                let _ = state.cache.clear_snooze(&account, &thread);
                let _ = app.emit("mail://changed", MailChanged { account_id: account.clone(), thread_ids: vec![thread.clone()], labels_changed: true, full_refresh: false });
            }
            Err(_) => {} // try again next cycle
        }
    }
}
