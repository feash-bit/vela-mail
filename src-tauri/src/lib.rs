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
mod reader_window;
mod sanitize;
mod secrets;
mod state;
mod sync;
mod updater;
mod updates;
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

/// Files dropped on the main window go to its composer. Pop-outs never get this.
fn handle_drag_drop(app: &AppHandle, dd: &DragDropEvent) {
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

fn reader_windows(app: &AppHandle) -> Vec<tauri::WebviewWindow> {
    app.webview_windows().into_iter().filter(|(label, _)| reader_window::is_reader(label)).map(|(_, w)| w).collect()
}

/// The main window is gone: close every pop-out too. `close()` (not `destroy()`) lets a
/// pop-out save its drafts and finish pending sends first; a safety net makes sure
/// Vela still exits if one never finishes.
fn close_readers(app: &AppHandle) {
    for w in reader_windows(app) {
        let _ = w.close();
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(10)).await;
        for w in reader_windows(&app) {
            let _ = w.destroy();
        }
    });
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

/// Command-line helpers that run without opening a window.
fn cli() -> Option<i32> {
    let args: Vec<String> = std::env::args().collect();
    match args.get(1).map(String::as_str) {
        Some("--version") => {
            println!("vela-mail {}", env!("CARGO_PKG_VERSION"));
            Some(0)
        }
        // Used by the release workflow: prove a release verifies with the key in this build.
        Some("--verify-release") if args.len() == 4 => {
            let cfg = updater::build_config();
            let run = || -> Result<String, String> {
                let manifest: updater::Manifest = serde_json::from_slice(&std::fs::read(&args[2]).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
                let bytes = std::fs::read(&args[3]).map_err(|e| e.to_string())?;
                let dir = std::env::temp_dir().join(format!("vela-verify-{}", std::process::id()));
                let staged = updater::verify_and_unpack(&cfg, &manifest, &bytes, &dir).map_err(|e| e.to_string())?;
                let _ = std::fs::remove_dir_all(&dir);
                Ok(format!("OK: Vela {} verified with the built-in key ({})", manifest.version, staged.display()))
            };
            match run() {
                Ok(msg) => {
                    println!("{msg}");
                    Some(0)
                }
                Err(e) => {
                    eprintln!("FAILED: {e}");
                    Some(1)
                }
            }
        }
        _ => None,
    }
}

pub fn run() {
    if let Some(code) = cli() {
        std::process::exit(code);
    }
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
                // Pop-out windows must not pile up in the state file; they remember only their size.
                .with_filter(|label| !reader_window::is_reader(label))
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
            updates::spawn(app.handle().clone());
            Ok(())
        })
        .on_window_event(|window, event| {
            let label = window.label();
            if label == "main" {
                match event {
                    WindowEvent::DragDrop(dd) => handle_drag_drop(window.app_handle(), dd),
                    WindowEvent::Destroyed => close_readers(window.app_handle()),
                    _ => {}
                }
            } else if reader_window::is_reader(label) {
                match event {
                    WindowEvent::Resized(size) => {
                        let maximized = window.is_maximized().unwrap_or(false);
                        let minimized = window.is_minimized().unwrap_or(false);
                        if !maximized && !minimized {
                            let logical = size.to_logical::<f64>(window.scale_factor().unwrap_or(1.0));
                            let state = window.app_handle().state::<state::AppState>();
                            *state.reader_size.lock().unwrap() = reader_window::clamp_size(logical.width, logical.height);
                        }
                    }
                    WindowEvent::Destroyed => {
                        let state = window.app_handle().state::<state::AppState>();
                        state.readers.lock().unwrap().remove(label);
                        let (w, h) = *state.reader_size.lock().unwrap();
                        reader_window::save_size(w, h);
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
            commands::open_reader_window,
            commands::reader_target,
            commands::reader_ready,
            commands::trust_sender,
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
            updates::update_status,
            updates::check_for_update,
            updates::download_update,
            updates::install_update,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Vela");
}
