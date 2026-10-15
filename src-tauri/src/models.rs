//! Data shapes shared with the UI. Field names are camelCase on the wire and
//! mirror `src/lib/types.ts`.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum AccountStatus {
    Ok,
    NeedsReauth,
    Offline,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: String,
    pub email: String,
    pub display_name: Option<String>,
    pub status: AccountStatus,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub version: String,
    pub has_client_config: bool,
    pub keyring_available: bool,
    pub accounts: Vec<Account>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Address {
    pub name: Option<String>,
    pub email: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LabelColor {
    pub background: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Label {
    pub id: String,
    pub name: String,
    pub kind: String, // "system" | "user"
    pub unread: u32,
    pub total: u32,
    pub color: Option<LabelColor>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadSummary {
    pub id: String,
    pub history_id: String,
    pub subject: String,
    pub snippet: String,
    pub senders: Vec<String>,
    pub from: Address,
    pub to: Vec<Address>,
    pub date: i64,
    pub unread: bool,
    pub starred: bool,
    pub important: bool,
    pub has_attachments: bool,
    pub has_draft: bool,
    pub message_count: u32,
    pub label_ids: Vec<String>,
    pub snoozed_until: Option<i64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadPage {
    pub threads: Vec<ThreadSummary>,
    pub next_page_token: Option<String>,
    pub result_size_estimate: u32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    pub id: String,
    pub message_id: String,
    pub filename: String,
    pub mime_type: String,
    pub size: u64,
    pub inline: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub id: String,
    pub thread_id: String,
    pub from: Address,
    pub to: Vec<Address>,
    pub cc: Vec<Address>,
    pub bcc: Vec<Address>,
    pub reply_to: Vec<Address>,
    pub subject: String,
    pub date: i64,
    pub snippet: String,
    pub label_ids: Vec<String>,
    pub unread: bool,
    pub starred: bool,
    pub is_draft: bool,
    /// Sanitised body HTML, ready for the sandboxed frame.
    pub html: String,
    /// Sanitised CSS from the email's own <style> blocks.
    pub css: String,
    pub plain_text: bool,
    pub blocked_remote: u32,
    pub attachments: Vec<Attachment>,
    pub message_id_header: Option<String>,
    pub references: Option<String>,
    pub list_unsubscribe: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadDetail {
    pub id: String,
    pub subject: String,
    pub label_ids: Vec<String>,
    pub messages: Vec<Message>,
    pub remote_allowed: bool,
}

/// Which list of threads to show.
#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum View {
    Label { label_id: String },
    Archive,
    Snoozed,
    Search { query: String },
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForwardedAttachment {
    pub message_id: String,
    pub attachment_id: String,
    pub filename: String,
    pub mime_type: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftInput {
    pub draft_id: Option<String>,
    pub thread_id: Option<String>,
    pub in_reply_to: Option<String>,
    pub references: Option<String>,
    pub to: Vec<Address>,
    pub cc: Vec<Address>,
    pub bcc: Vec<Address>,
    pub subject: String,
    pub html: String,
    pub text: String,
    /// Tokens from `pick_attachments` / drag-and-drop.
    pub attachment_tokens: Vec<String>,
    pub forwarded: Vec<ForwardedAttachment>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedDraft {
    pub draft_id: String,
    pub message_id: String,
    pub thread_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftContent {
    pub draft_id: String,
    pub thread_id: Option<String>,
    pub to: Vec<Address>,
    pub cc: Vec<Address>,
    pub bcc: Vec<Address>,
    pub subject: String,
    pub html: String,
    pub in_reply_to: Option<String>,
    pub references: Option<String>,
    pub files: Vec<LocalFile>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalFile {
    pub token: String,
    pub filename: String,
    pub size: u64,
    pub mime_type: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Contact {
    pub name: Option<String>,
    pub email: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Identity {
    pub email: String,
    pub display_name: Option<String>,
    pub signature: Option<String>,
}

/// Events pushed to the UI.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MailChanged {
    pub account_id: String,
    pub thread_ids: Vec<String>,
    pub labels_changed: bool,
    pub full_refresh: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncState {
    pub account_id: String,
    pub syncing: bool,
    pub last_sync: Option<i64>,
    pub error: Option<String>,
    pub error_code: Option<String>,
}
