//! Thin, resilient HTTP client for the Gmail API.
//!
//! - Adds the bearer token (from `Auth`) to every request.
//! - Retries 429 / 5xx / quota errors with exponential back-off and jitter,
//!   honouring `Retry-After`.
//! - On 401 it drops the cached access token and retries once.
//! - Caps concurrent requests per account so bursts stay under Gmail's
//!   per-user quota.

use super::api::*;
use crate::auth::Auth;
use crate::error::{AppError, AppResult};
use crate::models::AccountStatus;
use rand::Rng;
use serde::de::DeserializeOwned;
use serde_json::Value;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::Semaphore;

const API: &str = "https://gmail.googleapis.com/gmail/v1/users/me";
const UPLOAD: &str = "https://gmail.googleapis.com/upload/gmail/v1/users/me";
const MAX_ATTEMPTS: u32 = 5;

#[derive(Clone)]
pub struct Gmail {
    pub account: String,
    auth: Arc<Auth>,
    limiter: Arc<Semaphore>,
    api: Arc<str>,
    upload: Arc<str>,
}

enum Payload {
    None,
    Json(Value),
    Related { meta: Value, raw: Arc<Vec<u8>> },
}

impl Gmail {
    pub fn new(account: &str, auth: Arc<Auth>, limiter: Arc<Semaphore>) -> Self {
        Gmail { account: account.to_string(), auth, limiter, api: API.into(), upload: UPLOAD.into() }
    }

    /// Point the client at a local fake Gmail server (tests only).
    #[cfg(test)]
    pub fn with_base(account: &str, auth: Arc<Auth>, base: &str) -> Self {
        Gmail {
            account: account.to_string(),
            auth,
            limiter: Arc::new(Semaphore::new(4)),
            api: format!("{base}/gmail/v1/users/me").into(),
            upload: format!("{base}/upload/gmail/v1/users/me").into(),
        }
    }

    async fn request(&self, method: reqwest::Method, url: String, query: &[(&str, String)], payload: Payload) -> AppResult<reqwest::Response> {
        let _permit = self.limiter.acquire().await.map_err(AppError::internal)?;
        let mut attempt = 0;
        let mut refreshed = false;
        loop {
            attempt += 1;
            let token = self.auth.access_token(&self.account).await?;
            let mut req = self.auth.http.request(method.clone(), &url).bearer_auth(&token).query(query);
            req = match &payload {
                Payload::None => req,
                Payload::Json(v) => req.json(v),
                Payload::Related { meta, raw } => {
                    let boundary = format!("vela_{}", crate::oauth::random_b64(18).replace(['-', '_'], "x"));
                    let mut body = Vec::with_capacity(raw.len() + 512);
                    body.extend_from_slice(format!("--{boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n").as_bytes());
                    body.extend_from_slice(meta.to_string().as_bytes());
                    body.extend_from_slice(format!("\r\n--{boundary}\r\nContent-Type: message/rfc822\r\n\r\n").as_bytes());
                    body.extend_from_slice(raw);
                    body.extend_from_slice(format!("\r\n--{boundary}--").as_bytes());
                    req.header("Content-Type", format!("multipart/related; boundary={boundary}")).body(body)
                }
            };

            let resp = match req.timeout(Duration::from_secs(90)).send().await {
                Ok(r) => r,
                Err(e) => {
                    let err = AppError::from(e);
                    if matches!(err, AppError::Offline) && attempt < 3 {
                        backoff(attempt, None).await;
                        continue;
                    }
                    if matches!(err, AppError::Offline) {
                        self.auth.set_status(&self.account, AccountStatus::Offline);
                    }
                    return Err(err);
                }
            };
            let status = resp.status();
            if status.is_success() {
                self.auth.set_status(&self.account, AccountStatus::Ok);
                return Ok(resp);
            }
            let retry_after = resp
                .headers()
                .get("retry-after")
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.parse::<u64>().ok());
            let body: Option<ApiErrorBody> = resp.json().await.ok();
            let reason = body.as_ref().and_then(|b| b.error.errors.first()).map(|e| e.reason.clone()).unwrap_or_default();
            let message = body.map(|b| b.error.message).unwrap_or_else(|| status.to_string());

            match status.as_u16() {
                401 if !refreshed => {
                    refreshed = true;
                    self.auth.invalidate(&self.account);
                    continue;
                }
                401 => {
                    self.auth.set_status(&self.account, AccountStatus::NeedsReauth);
                    return Err(AppError::AuthExpired(self.account.clone()));
                }
                403 if reason.contains("RateLimit") || reason == "quotaExceeded" => {}
                429 | 500 | 502 | 503 | 504 => {}
                404 => return Err(AppError::NotFound("That item no longer exists in Gmail.".into())),
                s => return Err(AppError::Api { status: s, message }),
            }
            if attempt >= MAX_ATTEMPTS {
                return Err(if status.as_u16() == 429 || status.as_u16() == 403 { AppError::RateLimited } else { AppError::Api { status: status.as_u16(), message } });
            }
            backoff(attempt, retry_after).await;
        }
    }

    pub async fn get<T: DeserializeOwned>(&self, path: &str, query: &[(&str, String)]) -> AppResult<T> {
        let r = self.request(reqwest::Method::GET, format!("{}{path}", self.api), query, Payload::None).await?;
        Ok(r.json().await?)
    }

    pub async fn post_empty(&self, path: &str, body: Value) -> AppResult<()> {
        self.request(reqwest::Method::POST, format!("{}{path}", self.api), &[], Payload::Json(body)).await?;
        Ok(())
    }

    pub async fn delete(&self, path: &str) -> AppResult<()> {
        self.request(reqwest::Method::DELETE, format!("{}{path}", self.api), &[], Payload::None).await?;
        Ok(())
    }

    /// Multipart upload of a raw RFC 822 message plus JSON metadata.
    pub async fn upload<T: DeserializeOwned>(&self, method: reqwest::Method, path: &str, meta: Value, raw: Vec<u8>) -> AppResult<T> {
        let r = self
            .request(method, format!("{}{path}", self.upload), &[("uploadType", "multipart".into())], Payload::Related { meta, raw: Arc::new(raw) })
            .await?;
        Ok(r.json().await?)
    }

    // ---- Typed helpers ---------------------------------------------------

    pub async fn profile(&self) -> AppResult<Profile> {
        self.get("/profile", &[]).await
    }

    pub async fn send_as(&self) -> AppResult<SendAsList> {
        self.get("/settings/sendAs", &[]).await
    }

    pub async fn labels(&self) -> AppResult<LabelList> {
        self.get("/labels", &[]).await
    }

    pub async fn label(&self, id: &str) -> AppResult<RawLabel> {
        self.get(&format!("/labels/{}", enc(id)), &[]).await
    }

    pub async fn list_threads(&self, label: Option<&str>, q: Option<&str>, page: Option<&str>, include_spam_trash: bool, max: u32) -> AppResult<ThreadList> {
        let mut query = vec![("maxResults", max.to_string())];
        if let Some(l) = label {
            query.push(("labelIds", l.to_string()));
        }
        if let Some(q) = q.filter(|q| !q.trim().is_empty()) {
            query.push(("q", q.to_string()));
        }
        if let Some(p) = page {
            query.push(("pageToken", p.to_string()));
        }
        if include_spam_trash {
            query.push(("includeSpamTrash", "true".into()));
        }
        self.get("/threads", &query).await
    }

    pub async fn thread_metadata(&self, id: &str) -> AppResult<RawThread> {
        let mut q = vec![("format", "metadata".to_string())];
        for h in ["From", "To", "Subject", "Date", "Content-Type"] {
            q.push(("metadataHeaders", h.to_string()));
        }
        self.get(&format!("/threads/{}", enc(id)), &q).await
    }

    pub async fn thread_full(&self, id: &str) -> AppResult<RawThread> {
        self.get(&format!("/threads/{}", enc(id)), &[("format", "full".into())]).await
    }

    pub async fn attachment(&self, message_id: &str, attachment_id: &str) -> AppResult<Vec<u8>> {
        let a: AttachmentBody = self
            .get(&format!("/messages/{}/attachments/{}", enc(message_id), enc(attachment_id)), &[])
            .await?;
        super::parse::b64url_decode(&a.data).ok_or_else(|| AppError::Internal("Attachment data was corrupt.".into()))
    }

    pub async fn modify_thread(&self, id: &str, add: &[String], remove: &[String]) -> AppResult<()> {
        self.post_empty(&format!("/threads/{}/modify", enc(id)), serde_json::json!({ "addLabelIds": add, "removeLabelIds": remove })).await
    }

    pub async fn trash_thread(&self, id: &str) -> AppResult<()> {
        self.post_empty(&format!("/threads/{}/trash", enc(id)), serde_json::json!({})).await
    }

    pub async fn untrash_thread(&self, id: &str) -> AppResult<()> {
        self.post_empty(&format!("/threads/{}/untrash", enc(id)), serde_json::json!({})).await
    }

    pub async fn history(&self, start: &str, page: Option<&str>) -> AppResult<HistoryList> {
        let mut q = vec![("startHistoryId", start.to_string()), ("maxResults", "500".to_string())];
        if let Some(p) = page {
            q.push(("pageToken", p.to_string()));
        }
        self.get("/history", &q).await
    }

    pub async fn drafts_for_thread(&self) -> AppResult<Vec<DraftRef>> {
        let mut out = vec![];
        let mut page: Option<String> = None;
        for _ in 0..10 {
            let mut q = vec![("maxResults", "100".to_string())];
            if let Some(p) = &page {
                q.push(("pageToken", p.clone()));
            }
            let list: DraftList = self.get("/drafts", &q).await?;
            out.extend(list.drafts);
            page = list.next_page_token;
            if page.is_none() {
                break;
            }
        }
        Ok(out)
    }

    pub async fn draft(&self, id: &str) -> AppResult<RawDraft> {
        self.get(&format!("/drafts/{}", enc(id)), &[("format", "full".into())]).await
    }
}

/// Percent-encode a path segment (Gmail IDs are alphanumeric, but be strict).
pub fn enc(s: &str) -> String {
    url::form_urlencoded::byte_serialize(s.as_bytes()).collect()
}

async fn backoff(attempt: u32, retry_after: Option<u64>) {
    let base = retry_after.map(|s| s.min(60) * 1000).unwrap_or_else(|| 400u64 * 2u64.pow(attempt.min(6)));
    let jitter = rand::thread_rng().gen_range(0..300);
    tokio::time::sleep(Duration::from_millis(base + jitter)).await;
}
