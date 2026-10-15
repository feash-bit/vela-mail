//! Desktop notifications through org.freedesktop.Notifications (works with
//! KDE Plasma, GNOME and most other desktops). Clicking a notification brings
//! Vela to the front and opens the conversation.

use crate::models::ThreadSummary;
use crate::gmail::parse::display_name as parse_display;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenThread {
    pub account_id: String,
    pub thread_id: String,
}

pub fn focus_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

pub fn new_mail(app: &AppHandle, account: &str, threads: &[ThreadSummary], preview: bool) {
    if threads.is_empty() {
        return;
    }
    let (summary, body, target) = if threads.len() == 1 {
        let t = &threads[0];
        let mut body = if t.subject.is_empty() { "(no subject)".to_string() } else { t.subject.clone() };
        if preview && !t.snippet.is_empty() {
            body.push('\n');
            body.push_str(&t.snippet.chars().take(140).collect::<String>());
        }
        (parse_display(&t.from), body, Some(t.id.clone()))
    } else {
        let names: Vec<String> = threads.iter().take(3).map(|t| parse_display(&t.from)).collect();
        (format!("{} new messages", threads.len()), format!("From {}", names.join(", ")), None)
    };

    let app = app.clone();
    let account = account.to_string();
    // wait_for_action blocks, so each notification gets its own thread.
    std::thread::spawn(move || {
        let mut n = notify_rust::Notification::new();
        n.appname("Vela")
            .summary(&summary)
            // Plain text only: notification servers may interpret markup.
            .body(&body.replace(['<', '>', '&'], " "))
            .icon("vela-mail")
            .hint(notify_rust::Hint::Category("email.arrived".into()))
            .hint(notify_rust::Hint::DesktopEntry("vela-mail".into()))
            .action("default", "Open");
        match n.show() {
            Ok(handle) => handle.wait_for_action(|action| {
                if action == "default" {
                    focus_main(&app);
                    if let Some(thread_id) = &target {
                        let _ = app.emit("app://open-thread", OpenThread { account_id: account.clone(), thread_id: thread_id.clone() });
                    }
                }
            }),
            Err(e) => log::warn!("notification failed: {e}"),
        }
    });
}
