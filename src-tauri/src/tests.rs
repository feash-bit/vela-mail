//! End-to-end tests of the Gmail layer against a local fake Gmail server
//! (wiremock). They exercise the real HTTP client, retries, parsing,
//! sanitising, incremental sync and MIME uploads — everything except Google
//! itself.

use crate::auth::Auth;
use crate::cache::Cache;
use crate::error::AppError;
use crate::gmail::Gmail;
use crate::mail;
use crate::models::{Address, DraftInput, View};
use crate::state::AppState;
use crate::sync::collect_changes;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde_json::json;
use std::sync::{Arc, OnceLock};
use wiremock::matchers::{body_string_contains, header, method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

const ME: &str = "me@example.com";
static ENV: OnceLock<tempfile::TempDir> = OnceLock::new();

fn setup(server: &MockServer) -> (AppState, Gmail) {
    // Keep settings and cache files out of the real home directory.
    let dir = ENV.get_or_init(|| tempfile::tempdir().unwrap());
    std::env::set_var("XDG_CONFIG_HOME", dir.path());
    std::env::set_var("XDG_DATA_HOME", dir.path());
    let auth = Arc::new(Auth::new(reqwest::Client::new(), Box::new(|_, _| {})));
    auth.put(ME, "test-token".into(), 3600);
    let g = Gmail::with_base(ME, auth.clone(), &server.uri());
    (AppState::new(auth, Arc::new(Cache::memory())), g)
}

fn b64(s: &[u8]) -> String {
    URL_SAFE_NO_PAD.encode(s)
}

fn meta_thread(id: &str, subject: &str, from: &str, labels: &[&str]) -> serde_json::Value {
    json!({
        "id": id, "historyId": "77",
        "messages": [{
            "id": format!("{id}-m1"), "threadId": id, "labelIds": labels,
            "snippet": "It&#39;s ready", "internalDate": "1760000000000",
            "payload": { "headers": [
                {"name": "From", "value": from},
                {"name": "To", "value": ME},
                {"name": "Subject", "value": subject},
                {"name": "Content-Type", "value": "multipart/mixed; boundary=x"}
            ]}
        }]
    })
}

#[tokio::test]
async fn lists_threads_with_bearer_token_and_skips_deleted_ones() {
    let server = MockServer::start().await;
    let (state, g) = setup(&server);
    Mock::given(method("GET"))
        .and(path("/gmail/v1/users/me/threads"))
        .and(query_param("labelIds", "INBOX"))
        .and(header("authorization", "Bearer test-token"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "threads": [{"id": "t1"}, {"id": "t2"}], "nextPageToken": "p2", "resultSizeEstimate": 2
        })))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/gmail/v1/users/me/threads/t1"))
        .and(query_param("format", "metadata"))
        .respond_with(ResponseTemplate::new(200).set_body_json(meta_thread("t1", "Quarterly plan", "Ann Lee <ann@example.com>", &["INBOX", "UNREAD"])))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/gmail/v1/users/me/threads/t2"))
        .respond_with(ResponseTemplate::new(404).set_body_json(json!({"error": {"message": "Not Found"}})))
        .mount(&server)
        .await;

    let page = mail::list_view(&state, &g, &View::Label { label_id: "INBOX".into() }, None, None).await.unwrap();
    assert_eq!(page.threads.len(), 1, "deleted thread t2 is skipped");
    let t = &page.threads[0];
    assert_eq!(t.subject, "Quarterly plan");
    assert_eq!(t.snippet, "It's ready");
    assert!(t.unread && t.has_attachments);
    assert_eq!(t.from.name.as_deref(), Some("Ann Lee"));
    assert_eq!(page.next_page_token.as_deref(), Some("p2"));
    // And it landed in the local cache for instant start-up next time.
    assert_eq!(state.cache.threads_in_label(ME, "INBOX", 10).unwrap().len(), 1);
}

#[tokio::test]
async fn retries_after_rate_limit() {
    let server = MockServer::start().await;
    let (_state, g) = setup(&server);
    Mock::given(method("GET"))
        .and(path("/gmail/v1/users/me/profile"))
        .respond_with(ResponseTemplate::new(429).insert_header("retry-after", "0"))
        .up_to_n_times(2)
        .with_priority(1)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/gmail/v1/users/me/profile"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"emailAddress": ME, "historyId": "500"})))
        .mount(&server)
        .await;
    let p = g.profile().await.unwrap();
    assert_eq!(p.history_id, "500");
    assert_eq!(server.received_requests().await.unwrap().len(), 3);
}

#[tokio::test]
async fn gives_up_on_persistent_rate_limit_with_clear_error() {
    let server = MockServer::start().await;
    let (_state, g) = setup(&server);
    Mock::given(method("GET"))
        .and(path("/gmail/v1/users/me/profile"))
        .respond_with(ResponseTemplate::new(429).insert_header("retry-after", "0"))
        .mount(&server)
        .await;
    assert!(matches!(g.profile().await, Err(AppError::RateLimited)));
}

#[tokio::test]
async fn incremental_sync_reads_all_history_pages() {
    let server = MockServer::start().await;
    let (_state, g) = setup(&server);
    Mock::given(method("GET"))
        .and(path("/gmail/v1/users/me/history"))
        .and(query_param("pageToken", "next"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "history": [{"labelsRemoved": [{"message": {"id": "m3", "threadId": "t3"}, "labelIds": ["INBOX"]}]}],
            "historyId": "130"
        })))
        .with_priority(1)
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/gmail/v1/users/me/history"))
        .and(query_param("startHistoryId", "100"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "history": [
                {"messagesAdded": [{"message": {"id": "m1", "threadId": "t1", "labelIds": ["INBOX", "UNREAD"]}}]},
                {"messagesAdded": [{"message": {"id": "m2", "threadId": "t2", "labelIds": ["SENT"]}}]}
            ],
            "nextPageToken": "next", "historyId": "120"
        })))
        .mount(&server)
        .await;

    let c = collect_changes(&g, "100").await.unwrap();
    assert_eq!(c.changed.iter().map(String::as_str).collect::<Vec<_>>(), vec!["t1", "t2", "t3"]);
    assert_eq!(c.new_inbox_threads.iter().map(String::as_str).collect::<Vec<_>>(), vec!["t1"], "sent mail doesn't notify");
    assert!(c.labels_changed);
    assert_eq!(c.latest, "130");
}

#[tokio::test]
async fn expired_history_checkpoint_is_reported() {
    let server = MockServer::start().await;
    let (_state, g) = setup(&server);
    Mock::given(method("GET"))
        .and(path("/gmail/v1/users/me/history"))
        .respond_with(ResponseTemplate::new(404).set_body_json(json!({"error": {"message": "Requested entity was not found."}})))
        .mount(&server)
        .await;
    assert!(matches!(collect_changes(&g, "1").await, Err(AppError::NotFound(_))));
}

#[tokio::test]
async fn opens_thread_safely_with_inline_images() {
    let server = MockServer::start().await;
    let (state, g) = setup(&server);
    let html = r#"<p>Hello <b>there</b></p><img src="cid:logo@x"><img src="https://tracker.example/p.gif"><script>alert(1)</script><a href="javascript:evil()">x</a>"#;
    Mock::given(method("GET"))
        .and(path("/gmail/v1/users/me/threads/t1"))
        .and(query_param("format", "full"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "id": "t1", "historyId": "9",
            "messages": [{
                "id": "m1", "threadId": "t1", "labelIds": ["INBOX"], "snippet": "Hello", "internalDate": "1760000000000",
                "payload": {
                    "mimeType": "multipart/mixed",
                    "headers": [
                        {"name": "From", "value": "\"Lee, Ann\" <ann@example.com>"},
                        {"name": "To", "value": ME},
                        {"name": "Subject", "value": "Plans"},
                        {"name": "Message-ID", "value": "<orig@example.com>"}
                    ],
                    "parts": [
                        {"mimeType": "multipart/related", "parts": [
                            {"mimeType": "text/html", "headers": [{"name": "Content-Type", "value": "text/html; charset=UTF-8"}], "body": {"size": 10, "data": b64(html.as_bytes())}},
                            {"mimeType": "image/png", "filename": "logo.png", "headers": [{"name": "Content-ID", "value": "<logo@x>"}, {"name": "Content-Disposition", "value": "inline"}], "body": {"size": 4, "attachmentId": "A1"}}
                        ]},
                        {"mimeType": "application/pdf", "filename": "plan.pdf", "headers": [{"name": "Content-Disposition", "value": "attachment"}], "body": {"size": 2048, "attachmentId": "A2"}}
                    ]
                }
            }]
        })))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/gmail/v1/users/me/messages/m1/attachments/A1"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"size": 4, "data": b64(&[0x89, b'P', b'N', b'G'])})))
        .mount(&server)
        .await;

    let d = mail::thread_detail(&state, &g, "t1", false).await.unwrap();
    let m = &d.messages[0];
    assert!(m.html.contains("<b>there</b>"));
    assert!(m.html.contains("data:image/png;base64,iVBORw"), "cid image inlined: {}", m.html);
    assert!(!m.html.contains("tracker.example") && !m.html.contains("<script") && !m.html.contains("javascript:"));
    assert_eq!(m.blocked_remote, 1);
    assert_eq!(m.from.name.as_deref(), Some("Lee, Ann"));
    assert_eq!(m.attachments.iter().map(|a| a.filename.as_str()).collect::<Vec<_>>(), vec!["plan.pdf"], "inline logo isn't listed");
    assert_eq!(m.message_id_header.as_deref(), Some("<orig@example.com>"));

    // Second open is served from memory: no new request.
    let before = server.received_requests().await.unwrap().len();
    mail::thread_detail(&state, &g, "t1", false).await.unwrap();
    assert_eq!(server.received_requests().await.unwrap().len(), before);
}

fn draft(draft_id: Option<&str>) -> DraftInput {
    DraftInput {
        draft_id: draft_id.map(Into::into),
        thread_id: Some("t1".into()),
        in_reply_to: Some("<orig@example.com>".into()),
        references: Some("<orig@example.com>".into()),
        to: vec![Address { name: Some("Ann Lee".into()), email: "ann@example.com".into() }],
        cc: vec![],
        bcc: vec![],
        subject: "Re: Plans".into(),
        html: "<p>Sounds good</p>".into(),
        text: "Sounds good".into(),
        attachment_tokens: vec![],
        forwarded: vec![],
    }
}

async fn mount_identity(server: &MockServer) {
    Mock::given(method("GET"))
        .and(path("/gmail/v1/users/me/settings/sendAs"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "sendAs": [{"sendAsEmail": ME, "displayName": "Me Person", "isDefault": true, "signature": "<b>Me</b><script>x</script>"}]
        })))
        .mount(server)
        .await;
}

#[tokio::test]
async fn sends_reply_as_multipart_upload_in_the_same_thread() {
    let server = MockServer::start().await;
    let (state, g) = setup(&server);
    mount_identity(&server).await;
    Mock::given(method("POST"))
        .and(path("/upload/gmail/v1/users/me/messages/send"))
        .and(query_param("uploadType", "multipart"))
        .and(header("authorization", "Bearer test-token"))
        .and(body_string_contains(r#""threadId":"t1""#))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"id": "sent1", "threadId": "t1"})))
        .mount(&server)
        .await;

    let id = mail::send(&state, &g, &draft(None)).await.unwrap();
    assert_eq!(id, "sent1");
    let reqs = server.received_requests().await.unwrap();
    let upload = reqs.iter().find(|r| r.url.path().ends_with("/messages/send")).unwrap();
    let body = String::from_utf8_lossy(&upload.body);
    assert!(upload.headers.get("content-type").unwrap().to_str().unwrap().starts_with("multipart/related; boundary="));
    assert!(body.contains("Content-Type: message/rfc822"));
    assert!(body.contains("From: \"Me Person\" <me@example.com>"));
    assert!(body.contains("In-Reply-To: <orig@example.com>"));
    assert!(body.contains("Subject: Re: Plans"));
    // The signature from Gmail is sanitised before use.
    assert!(!mail::identity(&state, &g).await.unwrap().signature.unwrap().contains("<script"));
}

#[tokio::test]
async fn refuses_to_send_without_recipients() {
    let server = MockServer::start().await;
    let (state, g) = setup(&server);
    let mut d = draft(None);
    d.to.clear();
    assert!(matches!(mail::send(&state, &g, &d).await, Err(AppError::Invalid(_))));
    assert!(server.received_requests().await.unwrap().is_empty(), "nothing reaches Gmail");
}

#[tokio::test]
async fn draft_update_recreates_a_draft_deleted_elsewhere() {
    let server = MockServer::start().await;
    let (state, g) = setup(&server);
    mount_identity(&server).await;
    Mock::given(method("PUT"))
        .and(path("/upload/gmail/v1/users/me/drafts/d1"))
        .respond_with(ResponseTemplate::new(404).set_body_json(json!({"error": {"message": "Not Found"}})))
        .mount(&server)
        .await;
    Mock::given(method("POST"))
        .and(path("/upload/gmail/v1/users/me/drafts"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({"id": "d2", "message": {"id": "m9", "threadId": "t1"}})))
        .mount(&server)
        .await;
    let saved = mail::save_draft(&state, &g, &draft(Some("d1"))).await.unwrap();
    assert_eq!(saved.draft_id, "d2");
}

#[tokio::test]
async fn gmail_error_messages_reach_the_user() {
    let server = MockServer::start().await;
    let (_state, g) = setup(&server);
    Mock::given(method("POST"))
        .and(path("/gmail/v1/users/me/threads/t1/modify"))
        .respond_with(ResponseTemplate::new(400).set_body_json(json!({"error": {"message": "Invalid label: Label_9", "errors": [{"reason": "invalidArgument"}]}})))
        .mount(&server)
        .await;
    match g.modify_thread("t1", &["Label_9".into()], &[]).await {
        Err(AppError::Api { status: 400, message }) => assert!(message.contains("Invalid label")),
        other => panic!("unexpected: {other:?}"),
    }
}

#[tokio::test]
async fn unreachable_server_reports_offline() {
    let (state, _) = setup(&MockServer::start().await);
    let auth = state.auth.clone();
    // Nothing listens on port 9 (discard) on loopback.
    let g = Gmail::with_base(ME, auth, "http://127.0.0.1:9");
    assert!(matches!(g.profile().await, Err(AppError::Offline)));
}

// ---------------------------------------------------------------------------
// Self-updater against a fake release server, with archives signed by the
// real `tauri signer` (throwaway test key in test-fixtures/updates).
// ---------------------------------------------------------------------------

mod updates {
    use crate::updater::{download_and_stage, fetch_manifest, http_client, UpdaterConfig};
    use serde_json::json;
    use wiremock::matchers::{method, path};
    use wiremock::{Mock, MockServer, ResponseTemplate};

    const FX: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/test-fixtures/updates");
    fn fx(name: &str) -> Vec<u8> {
        std::fs::read(format!("{FX}/{name}")).unwrap()
    }
    fn fx_text(name: &str) -> String {
        String::from_utf8(fx(name)).unwrap().trim().to_string()
    }

    async fn serve(server: &MockServer, version: &str, archive: &str, signature: String) -> UpdaterConfig {
        Mock::given(method("GET"))
            .and(path("/latest.json"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "version": version,
                "notes": "Faster search and a new snooze menu.",
                "pub_date": "2026-10-20T00:00:00Z",
                "platforms": { "linux-x86_64": { "url": format!("{}/dl/{archive}", server.uri()), "signature": signature } }
            })))
            .mount(server)
            .await;
        Mock::given(method("GET"))
            .and(path(format!("/dl/{archive}")))
            .respond_with(ResponseTemplate::new(200).set_body_bytes(fx(archive)))
            .mount(server)
            .await;
        UpdaterConfig { endpoint: format!("{}/latest.json", server.uri()), pubkey: fx_text("test.key.pub") }
    }

    #[tokio::test]
    async fn installs_a_properly_signed_newer_release() {
        let server = MockServer::start().await;
        let cfg = serve(&server, "0.2.0", "vela-mail-0.2.0-linux-x86_64.tar.gz", fx_text("vela-mail-0.2.0-linux-x86_64.tar.gz.sig")).await;
        let http = http_client();
        let m = fetch_manifest(&http, &cfg).await.unwrap();
        assert_eq!(m.notes.as_deref(), Some("Faster search and a new snooze menu."));
        let dir = tempfile::tempdir().unwrap();
        let mut seen = 0.0;
        let staged = download_and_stage(&http, &cfg, &m, "0.1.0", dir.path(), |p| seen = p).await.unwrap();
        assert_eq!(std::fs::read_to_string(staged.join("VERSION")).unwrap().trim(), "0.2.0");
        assert!(std::fs::read_to_string(staged.join("vela-mail")).unwrap().contains("vela 0.2.0"));
        assert_eq!(seen, 1.0);
    }

    #[tokio::test]
    async fn rejects_a_signature_from_another_key() {
        let server = MockServer::start().await;
        let cfg = serve(&server, "0.2.0", "vela-mail-0.2.0-linux-x86_64.tar.gz", fx_text("attacker.sig")).await;
        let http = http_client();
        let m = fetch_manifest(&http, &cfg).await.unwrap();
        let dir = tempfile::tempdir().unwrap();
        let err = download_and_stage(&http, &cfg, &m, "0.1.0", dir.path(), |_| {}).await.unwrap_err();
        assert!(err.to_string().contains("signature"), "{err}");
        assert_eq!(std::fs::read_dir(dir.path()).map(|d| d.count()).unwrap_or(0), 0, "nothing unpacked");
    }

    #[tokio::test]
    async fn rejects_a_tampered_archive() {
        let server = MockServer::start().await;
        let name = "vela-mail-0.2.0-linux-x86_64.tar.gz";
        Mock::given(method("GET"))
            .and(path("/latest.json"))
            .respond_with(ResponseTemplate::new(200).set_body_json(json!({
                "version": "0.2.0",
                "platforms": { "linux-x86_64": { "url": format!("{}/dl/{name}", server.uri()), "signature": fx_text(&format!("{name}.sig")) } }
            })))
            .mount(&server)
            .await;
        let mut bytes = fx(name);
        let mid = bytes.len() / 2;
        bytes[mid] ^= 0xff;
        Mock::given(method("GET")).and(path(format!("/dl/{name}"))).respond_with(ResponseTemplate::new(200).set_body_bytes(bytes)).mount(&server).await;
        let cfg = UpdaterConfig { endpoint: format!("{}/latest.json", server.uri()), pubkey: fx_text("test.key.pub") };
        let http = http_client();
        let m = fetch_manifest(&http, &cfg).await.unwrap();
        let dir = tempfile::tempdir().unwrap();
        assert!(download_and_stage(&http, &cfg, &m, "0.1.0", dir.path(), |_| {}).await.is_err());
    }

    #[tokio::test]
    async fn rejects_an_old_release_replayed_as_new() {
        // A genuinely signed 0.1.5 build, advertised as 0.2.0.
        let server = MockServer::start().await;
        let cfg = serve(&server, "0.2.0", "vela-mail-0.1.5-linux-x86_64.tar.gz", fx_text("vela-mail-0.1.5-linux-x86_64.tar.gz.sig")).await;
        let http = http_client();
        let m = fetch_manifest(&http, &cfg).await.unwrap();
        let dir = tempfile::tempdir().unwrap();
        let err = download_and_stage(&http, &cfg, &m, "0.1.0", dir.path(), |_| {}).await.unwrap_err();
        assert!(err.to_string().contains("signed as"), "{err}");
    }

    #[tokio::test]
    async fn ignores_releases_that_are_not_newer() {
        let server = MockServer::start().await;
        let cfg = serve(&server, "0.2.0", "vela-mail-0.2.0-linux-x86_64.tar.gz", fx_text("vela-mail-0.2.0-linux-x86_64.tar.gz.sig")).await;
        let http = http_client();
        let m = fetch_manifest(&http, &cfg).await.unwrap();
        let dir = tempfile::tempdir().unwrap();
        assert!(download_and_stage(&http, &cfg, &m, "0.2.0", dir.path(), |_| {}).await.is_err());
    }

    #[tokio::test]
    async fn refuses_plain_http_to_other_hosts() {
        let cfg = UpdaterConfig { endpoint: "http://example.com/latest.json".into(), pubkey: fx_text("test.key.pub") };
        assert!(fetch_manifest(&http_client(), &cfg).await.is_err());
    }
}
