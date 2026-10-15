//! Mail operations shared by commands and the background sync.

use crate::error::{AppError, AppResult};
use crate::gmail::api::{RawDraft, RawMessage};
use crate::gmail::compose::{self, OutAttachment, Outgoing};
use crate::gmail::parse::{self, b64_standard, parse_address_list, InlinePart};
use crate::gmail::Gmail;
use crate::models::*;
use crate::sanitize;
use crate::state::AppState;
use futures::stream::{self, StreamExt};
use std::collections::HashMap;

const PAGE_SIZE: u32 = 40;
const MAX_INLINE_IMAGE: u64 = 5 * 1024 * 1024;
const MAX_INLINE_TOTAL: usize = 15 * 1024 * 1024;

/// Fetch thread summaries (metadata only) in parallel, keeping the order.
pub async fn summaries(state: &AppState, g: &Gmail, ids: Vec<String>) -> AppResult<(Vec<ThreadSummary>, Vec<String>)> {
    let results: Vec<(String, AppResult<_>)> = stream::iter(ids)
        .map(|id| async move {
            let r = g.thread_metadata(&id).await;
            (id, r)
        })
        .buffered(8)
        .collect()
        .await;

    let snoozes: HashMap<String, i64> = state.cache.snoozes(&g.account)?.into_iter().collect();
    let (mut out, mut gone) = (vec![], vec![]);
    for (id, r) in results {
        match r {
            Ok(raw) => {
                if let Some(mut s) = parse::summarize(&raw, &g.account) {
                    s.snoozed_until = snoozes.get(&s.id).copied();
                    out.push(s);
                } else {
                    gone.push(id);
                }
            }
            Err(AppError::NotFound(_)) => gone.push(id),
            Err(e @ (AppError::AuthExpired(_) | AppError::Offline | AppError::RateLimited)) => return Err(e),
            Err(e) => log::warn!("skipping thread after error: {}", e.code()),
        }
    }
    state.cache.upsert_threads(&g.account, &out)?;
    if !gone.is_empty() {
        state.cache.remove_threads(&g.account, &gone)?;
    }
    Ok((out, gone))
}

fn join_q(a: &str, b: Option<&str>) -> String {
    match b.map(str::trim).filter(|s| !s.is_empty()) {
        Some(b) => format!("{a} {b}").trim().to_string(),
        None => a.to_string(),
    }
}

pub async fn list_view(state: &AppState, g: &Gmail, view: &View, page: Option<&str>, filter: Option<&str>) -> AppResult<ThreadPage> {
    let (label, q, spam_trash): (Option<&str>, String, bool) = match view {
        View::Label { label_id } => (Some(label_id.as_str()), join_q("", filter), label_id == "SPAM" || label_id == "TRASH"),
        View::Archive => (None, join_q("-in:inbox -in:spam -in:trash -in:drafts -in:chats", filter), false),
        View::Snoozed => (None, join_q("in:snoozed", filter), false),
        View::Search { query } => (None, join_q(query, filter), false),
    };
    let list = g.list_threads(label, Some(&q), page, spam_trash, PAGE_SIZE).await?;
    let mut ids: Vec<String> = list.threads.into_iter().map(|t| t.id).collect();
    if matches!(view, View::Snoozed) && page.is_none() {
        for (id, _) in state.cache.snoozes(&g.account)? {
            if !ids.contains(&id) {
                ids.push(id);
            }
        }
    }
    let (mut threads, _) = summaries(state, g, ids).await?;
    if matches!(view, View::Snoozed) {
        threads.sort_by_key(|t| t.snoozed_until.unwrap_or(i64::MAX));
    }
    Ok(ThreadPage { threads, next_page_token: list.next_page_token, result_size_estimate: list.result_size_estimate })
}

pub fn cached_view(state: &AppState, account: &str, view: &View) -> AppResult<Vec<ThreadSummary>> {
    match view {
        View::Label { label_id } => state.cache.threads_in_label(account, label_id, PAGE_SIZE),
        _ => Ok(vec![]),
    }
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

const SYSTEM_LABELS: [&str; 7] = ["INBOX", "STARRED", "IMPORTANT", "SENT", "DRAFT", "SPAM", "TRASH"];

pub async fn labels(g: &Gmail) -> AppResult<Vec<Label>> {
    let list = g.labels().await?;
    let wanted: Vec<_> = list
        .labels
        .into_iter()
        .filter(|l| {
            if l.kind == "system" {
                SYSTEM_LABELS.contains(&l.id.as_str())
            } else {
                l.label_list_visibility.as_deref() != Some("labelHide")
            }
        })
        .collect();
    let ids: Vec<String> = wanted.iter().map(|l| l.id.clone()).collect();
    let detailed: Vec<AppResult<_>> = stream::iter(ids)
        .map(|id| async move { g.label(&id).await })
        .buffered(8)
        .collect()
        .await;
    let mut out = vec![];
    for r in detailed {
        let l = match r {
            Ok(l) => l,
            Err(AppError::NotFound(_)) => continue,
            Err(e) => return Err(e),
        };
        out.push(Label {
            kind: if l.kind == "system" { "system".into() } else { "user".into() },
            unread: l.threads_unread,
            total: l.threads_total,
            color: l.color.and_then(|c| Some(LabelColor { background: c.background_color?, text: c.text_color? })),
            id: l.id,
            name: l.name,
        });
    }
    out.sort_by(|a, b| a.kind.cmp(&b.kind).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(out)
}

pub async fn identity(state: &AppState, g: &Gmail) -> AppResult<Identity> {
    if let Some(i) = state.identities.lock().unwrap().get(&g.account) {
        return Ok(i.clone());
    }
    let list = g.send_as().await?;
    let primary = list
        .send_as
        .iter()
        .find(|s| s.is_default)
        .or_else(|| list.send_as.iter().find(|s| s.is_primary))
        .or_else(|| list.send_as.iter().find(|s| s.send_as_email.eq_ignore_ascii_case(&g.account)));
    let id = Identity {
        email: g.account.clone(),
        display_name: primary.and_then(|p| p.display_name.clone()).filter(|n| !n.trim().is_empty()),
        signature: primary
            .and_then(|p| p.signature.clone())
            .filter(|s| !s.trim().is_empty())
            .map(|s| sanitize::sanitize_email_html(&s, true, HashMap::new()).body),
    };
    state.identities.lock().unwrap().insert(g.account.clone(), id.clone());
    Ok(id)
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

async fn render_message(g: &Gmail, m: &RawMessage, allow_remote: bool, inline_budget: &mut usize) -> Message {
    let body = parse::parse_body(m);
    let mut cids = HashMap::new();
    if let Some(html) = &body.html {
        for (cid, part) in &body.inline {
            if !html.contains(&format!("cid:{cid}")) {
                continue;
            }
            let (bytes, mime) = match part {
                InlinePart::Data(b, mime) => (Some(b.clone()), mime.clone()),
                InlinePart::Remote(att_id, mime) => {
                    let size = body.attachments.iter().find(|a| &a.id == att_id).map(|a| a.size).unwrap_or(0);
                    if size > MAX_INLINE_IMAGE || *inline_budget < size as usize {
                        (None, mime.clone())
                    } else {
                        (g.attachment(&m.id, att_id).await.ok(), mime.clone())
                    }
                }
            };
            if let Some(b) = bytes {
                if b.len() <= *inline_budget {
                    *inline_budget -= b.len();
                    let mime = if mime.starts_with("image/") && !mime.contains("svg") { mime } else { "image/png".into() };
                    cids.insert(cid.clone(), format!("data:{mime};base64,{}", b64_standard(&b)));
                }
            }
        }
    }

    let (html, css, blocked, plain) = match (&body.html, &body.text) {
        (Some(h), _) => {
            let s = sanitize::sanitize_email_html(h, allow_remote, cids);
            (s.body, s.css, s.blocked_remote, false)
        }
        (None, Some(t)) => (sanitize::plain_to_html(t), String::new(), 0, true),
        _ => (String::new(), String::new(), 0, true),
    };

    let from = parse_address_list(m.header("From")).into_iter().next().unwrap_or(Address { name: None, email: String::new() });
    Message {
        id: m.id.clone(),
        thread_id: m.thread_id.clone(),
        from,
        to: parse_address_list(m.header("To")),
        cc: parse_address_list(m.header("Cc")),
        bcc: parse_address_list(m.header("Bcc")),
        reply_to: parse_address_list(m.header("Reply-To")),
        subject: m.header("Subject").unwrap_or("").to_string(),
        date: m.date_ms(),
        snippet: parse::decode_entities(&m.snippet),
        label_ids: m.label_ids.clone(),
        unread: m.has_label("UNREAD"),
        starred: m.has_label("STARRED"),
        is_draft: m.has_label("DRAFT"),
        html,
        css,
        plain_text: plain,
        blocked_remote: blocked,
        attachments: body.attachments.into_iter().filter(|a| !(a.inline && cid_used(&body.html, &body.inline, &a.id))).collect(),
        message_id_header: m.header("Message-ID").or_else(|| m.header("Message-Id")).map(str::to_string),
        references: m.header("References").map(str::to_string),
        list_unsubscribe: m.header("List-Unsubscribe").map(str::to_string),
    }
}

/// Inline images shown in the body don't need to be listed as attachments too.
fn cid_used(html: &Option<String>, inline: &HashMap<String, InlinePart>, att_id: &str) -> bool {
    let Some(html) = html else { return false };
    inline.iter().any(|(cid, p)| matches!(p, InlinePart::Remote(id, _) if id == att_id) && html.contains(&format!("cid:{cid}")))
}

pub async fn thread_detail(state: &AppState, g: &Gmail, id: &str, allow_remote: bool) -> AppResult<ThreadDetail> {
    if let Some(d) = state.cached_detail(&g.account, id, allow_remote) {
        return Ok(d);
    }
    let raw = g.thread_full(id).await?;
    let mut budget = MAX_INLINE_TOTAL;
    let mut messages = vec![];
    for m in raw.messages.iter().filter(|m| !m.has_label("DRAFT")) {
        messages.push(render_message(g, m, allow_remote, &mut budget).await);
    }
    let mut label_ids: Vec<String> = vec![];
    for m in &raw.messages {
        for l in &m.label_ids {
            if !label_ids.contains(l) {
                label_ids.push(l.clone());
            }
        }
    }
    let detail = ThreadDetail {
        id: raw.id.clone(),
        subject: messages.first().map(|m| m.subject.clone()).unwrap_or_default(),
        label_ids,
        messages,
        remote_allowed: allow_remote,
    };
    state.store_detail(&g.account, detail.clone());
    Ok(detail)
}

// ---------------------------------------------------------------------------
// Composing
// ---------------------------------------------------------------------------

async fn collect_attachments(state: &AppState, g: &Gmail, input: &DraftInput) -> AppResult<Vec<OutAttachment>> {
    let mut out = vec![];
    let picked: Vec<(std::path::PathBuf, String, String)> = {
        let files = state.files.lock().unwrap();
        input
            .attachment_tokens
            .iter()
            .map(|t| files.get(t).map(|f| (f.path.clone(), f.filename.clone(), f.mime_type.clone())))
            .collect::<Option<Vec<_>>>()
            .ok_or_else(|| AppError::Invalid("An attached file is no longer available. Attach it again.".into()))?
    };
    for (path, filename, mime_type) in picked {
        let meta = tokio::fs::metadata(&path).await.map_err(|_| AppError::Invalid(format!("\"{filename}\" was moved or deleted. Attach it again.")))?;
        if meta.len() > compose::MAX_ATTACHMENT_BYTES {
            return Err(AppError::Invalid(format!("\"{filename}\" is larger than 25 MB.")));
        }
        out.push(OutAttachment { filename, mime_type, data: tokio::fs::read(&path).await? });
    }
    for f in &input.forwarded {
        let data = g.attachment(&f.message_id, &f.attachment_id).await?;
        out.push(OutAttachment { filename: f.filename.clone(), mime_type: f.mime_type.clone(), data });
    }
    Ok(out)
}

async fn build_raw(state: &AppState, g: &Gmail, input: &DraftInput) -> AppResult<Vec<u8>> {
    let me = identity(state, g).await.unwrap_or(Identity { email: g.account.clone(), display_name: None, signature: None });
    let from = Address { name: me.display_name, email: me.email };
    let attachments = collect_attachments(state, g, input).await?;
    compose::build(Outgoing {
        from: &from,
        to: &input.to,
        cc: &input.cc,
        bcc: &input.bcc,
        subject: &input.subject,
        html: &input.html,
        text: &input.text,
        in_reply_to: input.in_reply_to.as_deref(),
        references: input.references.as_deref(),
        attachments,
    })
}

fn message_meta(input: &DraftInput) -> serde_json::Value {
    match &input.thread_id {
        Some(t) if !t.is_empty() => serde_json::json!({ "threadId": t }),
        _ => serde_json::json!({}),
    }
}

pub async fn save_draft(state: &AppState, g: &Gmail, input: &DraftInput) -> AppResult<SavedDraft> {
    let raw = build_raw(state, g, input).await?;
    let d: RawDraft = match &input.draft_id {
        Some(id) => {
            let meta = serde_json::json!({ "id": id, "message": message_meta(input) });
            match g.upload(reqwest::Method::PUT, &format!("/drafts/{}", crate::gmail::client::enc(id)), meta, raw.clone()).await {
                Ok(d) => d,
                // The draft was sent or deleted elsewhere: start a new one.
                Err(AppError::NotFound(_)) => g.upload(reqwest::Method::POST, "/drafts", serde_json::json!({ "message": message_meta(input) }), raw).await?,
                Err(e) => return Err(e),
            }
        }
        None => g.upload(reqwest::Method::POST, "/drafts", serde_json::json!({ "message": message_meta(input) }), raw).await?,
    };
    Ok(SavedDraft { draft_id: d.id, message_id: d.message.id, thread_id: d.message.thread_id })
}

pub async fn send(state: &AppState, g: &Gmail, input: &DraftInput) -> AppResult<String> {
    if input.to.is_empty() && input.cc.is_empty() && input.bcc.is_empty() {
        return Err(AppError::Invalid("Add at least one recipient.".into()));
    }
    let raw = build_raw(state, g, input).await?;
    let sent: RawMessage = match &input.draft_id {
        Some(id) => {
            let meta = serde_json::json!({ "id": id, "message": message_meta(input) });
            match g.upload(reqwest::Method::POST, "/drafts/send", meta, raw.clone()).await {
                Ok(m) => m,
                Err(AppError::NotFound(_)) => g.upload(reqwest::Method::POST, "/messages/send", message_meta(input), raw).await?,
                Err(e) => return Err(e),
            }
        }
        None => g.upload(reqwest::Method::POST, "/messages/send", message_meta(input), raw).await?,
    };
    // Sent successfully: forget the picked files.
    let mut files = state.files.lock().unwrap();
    for t in &input.attachment_tokens {
        files.remove(t);
    }
    Ok(sent.id)
}

pub async fn open_draft(state: &AppState, g: &Gmail, thread_id: &str) -> AppResult<DraftContent> {
    let drafts = g.drafts_for_thread().await?;
    let found = drafts
        .iter()
        .find(|d| d.message.thread_id == thread_id || d.message.id == thread_id)
        .ok_or_else(|| AppError::NotFound("No draft found in this conversation.".into()))?;
    let d = g.draft(&found.id).await?;
    let body = parse::parse_body(&d.message);
    let html = match (&body.html, &body.text) {
        (Some(h), _) => sanitize::sanitize_email_html(h, true, HashMap::new()).body,
        (None, Some(t)) => sanitize::plain_to_html(t),
        _ => String::new(),
    };
    // Draft attachments are copied into a private temp folder and registered
    // like picked files, because Gmail attachment IDs change on every save.
    let mut files = vec![];
    for a in &body.attachments {
        let data = g.attachment(&d.message.id, &a.id).await?;
        files.push(crate::files::register_bytes(state, &a.filename, &a.mime_type, &data)?);
    }
    let m = &d.message;
    Ok(DraftContent {
        files,
        draft_id: d.id.clone(),
        thread_id: (!m.thread_id.is_empty()).then(|| m.thread_id.clone()),
        to: parse_address_list(m.header("To")),
        cc: parse_address_list(m.header("Cc")),
        bcc: parse_address_list(m.header("Bcc")),
        subject: m.header("Subject").unwrap_or("").to_string(),
        html,
        in_reply_to: m.header("In-Reply-To").map(str::to_string),
        references: m.header("References").map(str::to_string),
    })
}
