//! Vela — Gmail desktop client. Rust backend entry point.

mod auth;
mod cache;
mod commands;
mod config;
mod error;
mod files;
mod gmail;
mod mail;
mod models;
mod notify;
mod oauth;
mod sanitize;
mod secrets;
mod state;
mod sync;
#[cfg(test)]
mod tests;

use std::sync::{Arc, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, DragDropEvent, Emitter, Manager, WindowEvent};

static APP: OnceLock<AppHandle> = OnceLock::new();

fn mailto_from_args(args: &[String]) -> Option<String> {
    args.iter()
        .find(|a| a.to_ascii_lowercase().starts_with("mailto:") && a.len() < 8192)
        .cloned()
}

/// Linux desktop tweaks applied before GTK starts. Each one respects a value
/// the user has already set in their environment.
fn apply_linux_env() {
    let unset = |k: &str| std::env::var_os(k).is_none();
    // WebKitGTK's DMA-BUF renderer shows a blank window on some NVIDIA setups.
    if std::path::Path::new("/proc/driver/nvidia/version").exists() && unset("WEBKIT_DISABLE_DMABUF_RENDERER") {
        std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    }
    // GTK overlay scroll indicators are drawn above web content (they show
    // through dialogs). Classic mode lets Vela's own thin scrollbars render.
    if unset("GTK_OVERLAY_SCROLLING") {
        std::env::set_var("GTK_OVERLAY_SCROLLING", "0");
    }
    // On KDE Plasma, route file dialogs through the desktop portal so they
    // are Plasma's own pickers (GTK falls back to its dialog if no portal).
    let kde = std::env::var("XDG_CURRENT_DESKTOP").map(|d| d.to_ascii_uppercase().contains("KDE")).unwrap_or(false);
    if kde && unset("GTK_USE_PORTAL") {
        std::env::set_var("GTK_USE_PORTAL", "1");
    }
}

#[tauri::command]
fn window_ready(app: AppHandle, state: tauri::State<'_, state::AppState>) {
    show_main(&app, &state);
}

fn show_main(app: &AppHandle, state: &state::AppState) {
    let Some(w) = app.get_webview_window("main") else { return };
    if w.is_visible().unwrap_or(false) {
        return;
    }
    let minimized = state.settings().start_minimized || std::env::args().any(|a| a == "--minimized");
    let _ = w.show();
    if minimized {
        let _ = w.minimize();
    } else {
        let _ = w.set_focus();
    }
}

pub fn run() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("warn")).init();
    apply_linux_env();
    files::clean_temp();

    let http = reqwest::Client::builder()
        .user_agent(concat!("Vela/", env!("CARGO_PKG_VERSION")))
        .https_only(true)
        .connect_timeout(Duration::from_secs(15))
        .pool_idle_timeout(Duration::from_secs(60))
        .build()
        .expect("HTTP client");

    let auth = Arc::new(auth::Auth::new(
        http,
        Box::new(|account, status| {
            if let Some(app) = APP.get() {
                let _ = app.emit("account://status", serde_json::json!({ "accountId": account, "status": status }));
            }
        }),
    ));
    let cache = Arc::new(cache::Cache::open_default().expect("Vela couldn't open its local cache in ~/.local/share/vela-mail"));
    let app_state = state::AppState::new(auth, cache);

    tauri::Builder::default()
        // Must be first: a second launch (e.g. a mailto: link) focuses this window instead.
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            notify::focus_main(app);
            if let Some(m) = mailto_from_args(&argv) {
                let _ = app.emit("app://mailto", m);
            }
        }))
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(tauri_plugin_window_state::StateFlags::all() & !tauri_plugin_window_state::StateFlags::VISIBLE & !tauri_plugin_window_state::StateFlags::DECORATIONS)
                .build(),
        )
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, Some(vec!["--minimized"])))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(app_state)
        .setup(|app| {
            let _ = APP.set(app.handle().clone());
            let state = app.state::<state::AppState>();
            let args: Vec<String> = std::env::args().collect();
            *state.pending_mailto.lock().unwrap() = mailto_from_args(&args);
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.set_decorations(!state.settings().custom_title_bar);
            }
            // Fallback: show the window even if the UI never reports ready.
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                tokio::time::sleep(Duration::from_secs(4)).await;
                let st = handle.state::<state::AppState>();
                show_main(&handle, &st);
            });
            sync::spawn(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::DragDrop(dd) = event {
                let app = window.app_handle();
                match dd {
                    DragDropEvent::Enter { .. } | DragDropEvent::Over { .. } => {
                        let _ = app.emit("files://hover", true);
                    }
                    DragDropEvent::Leave => {
                        let _ = app.emit("files://hover", false);
                    }
                    DragDropEvent::Drop { paths, .. } => {
                        let state = app.state::<state::AppState>();
                        let mut ok = vec![];
                        let mut errors = vec![];
                        for p in paths {
                            match files::register_path(&state, p) {
                                Ok(f) => ok.push(f),
                                Err(e) => errors.push(e.to_string()),
                            }
                        }
                        let _ = app.emit("files://hover", false);
                        let _ = app.emit("files://dropped", serde_json::json!({ "files": ok, "errors": errors }));
                    }
                    _ => {}
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            window_ready,
            commands::app_info,
            commands::get_settings,
            commands::save_settings,
            commands::import_client_config,
            commands::take_pending_mailto,
            commands::open_external,
            commands::add_account,
            commands::cancel_sign_in,
            commands::remove_account,
            commands::get_identity,
            commands::list_labels,
            commands::list_threads,
            commands::cached_threads,
            commands::get_thread,
            commands::suggest_contacts,
            commands::sync_now,
            commands::modify_threads,
            commands::trash_threads,
            commands::snooze_threads,
            commands::save_draft,
            commands::send_message,
            commands::delete_draft,
            commands::open_draft,
            commands::pick_attachments,
            commands::release_attachment,
            commands::save_attachment,
            commands::open_attachment,
            commands::attachment_preview,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Vela");
}
