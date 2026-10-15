//! Raw JSON shapes returned by the Gmail REST API (v1). Only the fields Vela
//! uses are declared; everything else is ignored.

use serde::Deserialize;

#[derive(Debug, Clone, Deserialize)]
pub struct Header {
    pub name: String,
    pub value: String,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Body {
    pub attachment_id: Option<String>,
    #[serde(default)]
    pub size: u64,
    pub data: Option<String>,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Part {
    #[serde(default)]
    pub mime_type: String,
    #[serde(default)]
    pub filename: String,
    #[serde(default)]
    pub headers: Vec<Header>,
    #[serde(default)]
    pub body: Body,
    #[serde(default)]
    pub parts: Vec<Part>,
}

impl Part {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers.iter().find(|h| h.name.eq_ignore_ascii_case(name)).map(|h| h.value.as_str())
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawMessage {
    pub id: String,
    #[serde(default)]
    pub thread_id: String,
    #[serde(default)]
    pub label_ids: Vec<String>,
    #[serde(default)]
    pub snippet: String,
    #[serde(default)]
    pub internal_date: String,
    pub payload: Option<Part>,
}

impl RawMessage {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.payload.as_ref().and_then(|p| p.header(name))
    }
    pub fn date_ms(&self) -> i64 {
        self.internal_date.parse().unwrap_or(0)
    }
    pub fn has_label(&self, l: &str) -> bool {
        self.label_ids.iter().any(|x| x == l)
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawThread {
    pub id: String,
    #[serde(default)]
    pub history_id: String,
    #[serde(default)]
    pub messages: Vec<RawMessage>,
}

#[derive(Debug, Deserialize)]
pub struct ThreadRef {
    pub id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThreadList {
    #[serde(default)]
    pub threads: Vec<ThreadRef>,
    pub next_page_token: Option<String>,
    #[serde(default)]
    pub result_size_estimate: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawLabelColor {
    pub background_color: Option<String>,
    pub text_color: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RawLabel {
    pub id: String,
    pub name: String,
    #[serde(rename = "type", default)]
    pub kind: String,
    #[serde(default)]
    pub threads_total: u32,
    #[serde(default)]
    pub threads_unread: u32,
    pub label_list_visibility: Option<String>,
    pub color: Option<RawLabelColor>,
}

#[derive(Debug, Deserialize)]
pub struct LabelList {
    #[serde(default)]
    pub labels: Vec<RawLabel>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MsgRef {
    pub id: String,
    #[serde(default)]
    pub thread_id: String,
    #[serde(default)]
    pub label_ids: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct MsgWrap {
    pub message: MsgRef,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LabelChange {
    pub message: MsgRef,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct History {
    #[serde(default)]
    pub messages: Vec<MsgRef>,
    #[serde(default)]
    pub messages_added: Vec<MsgWrap>,
    #[serde(default)]
    pub messages_deleted: Vec<MsgWrap>,
    #[serde(default)]
    pub labels_added: Vec<LabelChange>,
    #[serde(default)]
    pub labels_removed: Vec<LabelChange>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryList {
    #[serde(default)]
    pub history: Vec<History>,
    pub next_page_token: Option<String>,
    pub history_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub email_address: String,
    pub history_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendAs {
    pub send_as_email: String,
    pub display_name: Option<String>,
    #[serde(default)]
    pub is_default: bool,
    #[serde(default)]
    pub is_primary: bool,
    pub signature: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendAsList {
    #[serde(default)]
    pub send_as: Vec<SendAs>,
}

#[derive(Debug, Deserialize)]
pub struct RawDraft {
    pub id: String,
    pub message: RawMessage,
}

#[derive(Debug, Deserialize)]
pub struct DraftRef {
    pub id: String,
    pub message: MsgRef,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftList {
    #[serde(default)]
    pub drafts: Vec<DraftRef>,
    pub next_page_token: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct AttachmentBody {
    pub data: String,
}

#[derive(Debug, Deserialize)]
pub struct ApiErrorBody {
    pub error: ApiErrorInner,
}

#[derive(Debug, Deserialize)]
pub struct ApiErrorInner {
    #[serde(default)]
    pub message: String,
    #[serde(default)]
    pub errors: Vec<ApiErrorItem>,
}

#[derive(Debug, Deserialize)]
pub struct ApiErrorItem {
    #[serde(default)]
    pub reason: String,
}
