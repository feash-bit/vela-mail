//! Tauri commands: the only bridge between the UI and the outside world.

use crate::config::{self, Settings, StoredAccount};
use crate::error::{AppError, AppResult};
use crate::models::*;
use crate::state::AppState;
use crate::{files, mail, oauth, secrets, sync};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

type S<'a> = State<'a, AppState>;

fn accounts_view(state: &AppState) -> Vec<Account> {
    state
        .accounts
        .read()
        .unwrap()
        .iter()
        .map(|a| Account { id: a.email.clone(), email: a.email.clone(), display_name: a.display_name.clone(), status: state.auth.status(&a.email) })
        .collect()
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> T + Send + 'static) -> AppResult<T> {
    tokio::task::spawn_blocking(f).await.map_err(AppError::internal)
}

// ---- App & settings ---------------------------------------------------------

#[tauri::command]
pub async fn app_info(app: AppHandle, state: S<'_>) -> AppResult<AppInfo> {
    Ok(AppInfo {
        version: app.package_info().version.to_string(),
        has_client_config: config::has_client(),
        keyring_available: blocking(secrets::keyring_available).await?,
        accounts: accounts_view(&state),
    })
}

#[tauri::command]
pub fn get_settings(state: S<'_>) -> Settings {
    state.settings()
}

#[tauri::command]
pub fn save_settings(app: AppHandle, state: S<'_>, settings: Settings) -> AppResult<Settings> {
    let s = settings.sanitized();
    let prev = state.settings();
    config::save_settings(&s)?;
    if prev.launch_at_login != s.launch_at_login {
        use tauri_plugin_autostart::ManagerExt;
        let al = app.autolaunch();
        let _ = if s.launch_at_login { al.enable() } else { al.disable() };
    }
    let wake = prev.sync_interval_secs != s.sync_interval_secs;
    *state.settings.write().unwrap() = s.clone();
    if wake {
        state.sync_wake.notify_one();
    }
    Ok(s)
}

#[tauri::command]
pub async fn import_client_config(app: AppHandle) -> AppResult<bool> {
    let picked = blocking(move || {
        app.dialog()
            .file()
            .set_title("Choose your Google OAuth client file")
            .add_filter("OAuth client (JSON)", &["json"])
            .blocking_pick_file()
    })
    .await?;
    let Some(file) = picked else { return Ok(false) };
    let path = file.into_path().map_err(|_| AppError::Invalid("Choose a file on this computer.".into()))?;
    config::import_client(&path)?;
    Ok(true)
}

#[tauri::command]
pub fn take_pending_mailto(state: S<'_>) -> Option<String> {
    state.pending_mailto.lock().unwrap().take()
}

#[tauri::command]
pub fn open_external(app: AppHandle, url: String) -> AppResult<()> {
    let parsed = url::Url::parse(url.trim()).map_err(|_| AppError::Invalid("That link isn't valid.".into()))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(AppError::Invalid("Only web links can be opened.".into()));
    }
    app.opener().open_url(parsed.as_str(), None::<&str>).map_err(AppError::internal)
}

// ---- Accounts ---------------------------------------------------------------

#[tauri::command]
pub async fn add_account(app: AppHandle, state: S<'_>, login_hint: Option<String>) -> AppResult<Account> {
    let client = config::load_client()?;
    if !blocking(secrets::keyring_available).await? {
        return Err(AppError::Keyring(
            "On KDE Plasma, open System Settings → KDE Wallet and enable the wallet. Elsewhere, install and unlock gnome-keyring.".into(),
        ));
    }
    let opener_app = app.clone();
    let tokens = oauth::sign_in(&client, &state.auth.http, state.sign_in_cancel.clone(), login_hint.as_deref(), move |url| {
        opener_app.opener().open_url(url, None::<&str>).map_err(|_| AppError::Invalid("Couldn't open your web browser.".into()))
    })
    .await?;
    crate::notify::focus_main(&app);

    // Find out which account just signed in.
    let profile: crate::gmail::api::Profile = state
        .auth
        .http
        .get("https://gmail.googleapis.com/gmail/v1/users/me/profile")
        .bearer_auth(&tokens.access_token)
        .send()
        .await?
        .error_for_status()
        .map_err(|e| AppError::Api { status: e.status().map(|s| s.as_u16()).unwrap_or(0), message: "Couldn't read the Gmail profile.".into() })?
        .json()
        .await?;
    let email = profile.email_address.to_lowercase();
    if let Some(expected) = login_hint.as_deref().map(str::to_lowercase) {
        if expected != email {
            return Err(AppError::Invalid(format!("You signed in as {email}, but this account is {expected}. Try again with the right account.")));
        }
    }

    let refresh = match tokens.refresh_token.clone() {
        Some(r) => r,
        None => blocking({
            let e = email.clone();
            move || secrets::load_refresh_token(&e)
        })
        .await??
        .ok_or_else(|| AppError::Invalid("Google didn't return a long-term sign-in token. Remove Vela at myaccount.google.com/permissions and try again.".into()))?,
    };
    blocking({
        let (e, r) = (email.clone(), refresh);
        move || secrets::store_refresh_token(&e, &r)
    })
    .await??;
    state.auth.put(&email, tokens.access_token, tokens.expires_in);

    {
        let mut list = state.accounts.write().unwrap();
        if !list.iter().any(|a| a.email == email) {
            list.push(StoredAccount { email: email.clone(), display_name: None, added_at: sync::now_ms() });
        }
        config::save_accounts(&list)?;
    }
    // Pick up the display name from Gmail's "Send mail as" settings.
    if let Ok(g) = state.gmail(&email) {
        if let Ok(id) = mail::identity(&state, &g).await {
            let mut list = state.accounts.write().unwrap();
            if let Some(a) = list.iter_mut().find(|a| a.email == email) {
                a.display_name = id.display_name;
            }
            let _ = config::save_accounts(&list);
        }
    }
    state.sync_wake.notify_one();
    let acct = accounts_view(&state).into_iter().find(|a| a.email == email).ok_or_else(|| AppError::internal("account vanished"))?;
    let _ = app.emit("accounts://changed", accounts_view(&state));
    Ok(acct)
}

#[tauri::command]
pub fn cancel_sign_in(state: S<'_>) {
    state.sign_in_cancel.notify_waiters();
}

#[tauri::command]
pub async fn remove_account(app: AppHandle, state: S<'_>, account_id: String) -> AppResult<Vec<Account>> {
    // Revoke at Google (best effort), then remove every local trace.
    let token = blocking({
        let a = account_id.clone();
        move || secrets::load_refresh_token(&a)
    })
    .await?
    .ok()
    .flatten();
    if let Some(t) = token {
        oauth::revoke(&state.auth.http, &t).await;
    }
    blocking({
        let a = account_id.clone();
        move || secrets::delete_refresh_token(&a)
    })
    .await??;
    {
        let mut list = state.accounts.write().unwrap();
        list.retain(|a| a.email != account_id);
        config::save_accounts(&list)?;
    }
    state.cache.purge_account(&account_id)?;
    state.forget_account_memory(&account_id);
    let view = accounts_view(&state);
    let _ = app.emit("accounts://changed", view.clone());
    Ok(view)
}

#[tauri::command]
pub async fn get_identity(state: S<'_>, account_id: String) -> AppResult<Identity> {
    let g = state.gmail(&account_id)?;
    mail::identity(&state, &g).await
}

// ---- Reading ----------------------------------------------------------------

#[tauri::command]
pub async fn list_labels(state: S<'_>, account_id: String) -> AppResult<Vec<Label>> {
    let g = state.gmail(&account_id)?;
    mail::labels(&g).await
}

#[tauri::command]
pub async fn list_threads(state: S<'_>, account_id: String, view: View, page_token: Option<String>, filter: Option<String>) -> AppResult<ThreadPage> {
    let g = state.gmail(&account_id)?;
    mail::list_view(&state, &g, &view, page_token.as_deref(), filter.as_deref()).await
}

#[tauri::command]
pub fn cached_threads(state: S<'_>, account_id: String, view: View) -> AppResult<Vec<ThreadSummary>> {
    state.gmail(&account_id)?;
    mail::cached_view(&state, &account_id, &view)
}

#[tauri::command]
pub async fn get_thread(state: S<'_>, account_id: String, thread_id: String, allow_remote: bool) -> AppResult<ThreadDetail> {
    let g = state.gmail(&account_id)?;
    mail::thread_detail(&state, &g, &thread_id, allow_remote).await
}

#[tauri::command]
pub fn suggest_contacts(state: S<'_>, account_id: String, query: String) -> AppResult<Vec<Contact>> {
    state.gmail(&account_id)?;
    state.cache.contacts(&account_id, query.trim(), 8)
}

#[tauri::command]
pub fn sync_now(state: S<'_>) {
    state.sync_wake.notify_one();
}

// ---- Organising -------------------------------------------------------------

async fn after_change(state: &AppState, g: &crate::gmail::Gmail, ids: &[String]) {
    state.invalidate_details(&g.account, ids);
    let _ = mail::summaries(state, g, ids.to_vec()).await;
}

#[tauri::command]
pub async fn modify_threads(state: S<'_>, account_id: String, thread_ids: Vec<String>, add: Vec<String>, remove: Vec<String>) -> AppResult<()> {
    let g = state.gmail(&account_id)?;
    for id in &thread_ids {
        g.modify_thread(id, &add, &remove).await?;
        if add.iter().any(|l| l == "INBOX") {
            state.cache.clear_snooze(&account_id, id)?;
        }
    }
    after_change(&state, &g, &thread_ids).await;
    Ok(())
}

#[tauri::command]
pub async fn trash_threads(state: S<'_>, account_id: String, thread_ids: Vec<String>, restore: bool) -> AppResult<()> {
    let g = state.gmail(&account_id)?;
    for id in &thread_ids {
        if restore {
            g.untrash_thread(id).await?;
        } else {
            g.trash_thread(id).await?;
        }
    }
    after_change(&state, &g, &thread_ids).await;
    Ok(())
}

#[tauri::command]
pub async fn snooze_threads(state: S<'_>, account_id: String, thread_ids: Vec<String>, until: Option<i64>) -> AppResult<()> {
    let g = state.gmail(&account_id)?;
    for id in &thread_ids {
        match until {
            Some(t) if t > sync::now_ms() => {
                g.modify_thread(id, &[], &["INBOX".into()]).await?;
                state.cache.set_snooze(&account_id, id, t)?;
            }
            Some(_) => return Err(AppError::Invalid("Pick a time in the future.".into())),
            None => {
                g.modify_thread(id, &["INBOX".into()], &[]).await?;
                state.cache.clear_snooze(&account_id, id)?;
            }
        }
    }
    after_change(&state, &g, &thread_ids).await;
    Ok(())
}

// ---- Composing --------------------------------------------------------------

#[tauri::command]
pub async fn save_draft(state: S<'_>, account_id: String, draft: DraftInput) -> AppResult<SavedDraft> {
    let g = state.gmail(&account_id)?;
    mail::save_draft(&state, &g, &draft).await
}

#[tauri::command]
pub async fn send_message(state: S<'_>, account_id: String, draft: DraftInput) -> AppResult<String> {
    let g = state.gmail(&account_id)?;
    let id = mail::send(&state, &g, &draft).await?;
    state.sync_wake.notify_one();
    Ok(id)
}

#[tauri::command]
pub async fn delete_draft(state: S<'_>, account_id: String, draft_id: String) -> AppResult<()> {
    let g = state.gmail(&account_id)?;
    match g.delete(&format!("/drafts/{}", crate::gmail::client::enc(&draft_id))).await {
        Ok(()) | Err(AppError::NotFound(_)) => Ok(()),
        Err(e) => Err(e),
    }
}

#[tauri::command]
pub async fn open_draft(state: S<'_>, account_id: String, thread_id: String) -> AppResult<DraftContent> {
    let g = state.gmail(&account_id)?;
    mail::open_draft(&state, &g, &thread_id).await
}

// ---- Files ------------------------------------------------------------------

#[tauri::command]
pub async fn pick_attachments(app: AppHandle) -> AppResult<Vec<LocalFile>> {
    let a = app.clone();
    let picked = blocking(move || a.dialog().file().set_title("Attach files").blocking_pick_files()).await?;
    let state = app.state::<AppState>();
    let mut out = vec![];
    for f in picked.unwrap_or_default() {
        if let Ok(p) = f.into_path() {
            out.push(files::register_path(&state, &p)?);
        }
    }
    Ok(out)
}

#[tauri::command]
pub fn release_attachment(state: S<'_>, token: String) {
    state.files.lock().unwrap().remove(&token);
}

#[tauri::command]
pub async fn save_attachment(app: AppHandle, state: S<'_>, account_id: String, message_id: String, attachment_id: String, filename: String) -> AppResult<bool> {
    let g = state.gmail(&account_id)?;
    let name = files::safe_filename(&filename);
    let a = app.clone();
    let target = blocking(move || a.dialog().file().set_title("Save attachment").set_file_name(&name).blocking_save_file()).await?;
    let Some(target) = target else { return Ok(false) };
    let path = target.into_path().map_err(|_| AppError::Invalid("Choose a folder on this computer.".into()))?;
    let data = g.attachment(&message_id, &attachment_id).await?;
    tokio::fs::write(&path, data).await?;
    Ok(true)
}

/// Inline preview for image attachments only (PNG/JPEG/GIF/WebP, max 8 MB), as a data URL.
#[tauri::command]
pub async fn attachment_preview(state: S<'_>, account_id: String, message_id: String, attachment_id: String, mime_type: String) -> AppResult<String> {
    let mime = mime_type.to_ascii_lowercase();
    if !["image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp"].contains(&mime.as_str()) {
        return Err(AppError::Invalid("Only images can be previewed.".into()));
    }
    let g = state.gmail(&account_id)?;
    let data = g.attachment(&message_id, &attachment_id).await?;
    if data.len() > 8 * 1024 * 1024 {
        return Err(AppError::Invalid("This image is too large to preview.".into()));
    }
    Ok(format!("data:{mime};base64,{}", crate::gmail::parse::b64_standard(&data)))
}

#[tauri::command]
pub async fn open_attachment(app: AppHandle, state: S<'_>, account_id: String, message_id: String, attachment_id: String, filename: String) -> AppResult<()> {
    if files::is_risky(&filename) {
        return Err(AppError::Invalid(format!(
            "\"{filename}\" could run code on your computer, so Vela won't open it directly. Save it instead and only open it if you trust the sender."
        )));
    }
    let g = state.gmail(&account_id)?;
    let data = g.attachment(&message_id, &attachment_id).await?;
    let path = files::write_temp_attachment(&filename, &data)?;
    app.opener().open_path(path.to_string_lossy(), None::<&str>).map_err(AppError::internal)
}
