//! Turning Gmail API payloads into Vela's models: address lists, bodies with
//! the right character set, attachments, inline images and thread summaries.

use super::api::{Part, RawMessage, RawThread};
use crate::models::{Address, Attachment, ThreadSummary};
use base64::engine::general_purpose::{STANDARD, URL_SAFE, URL_SAFE_NO_PAD};
use base64::Engine;
use std::collections::HashMap;

pub fn b64url_decode(s: &str) -> Option<Vec<u8>> {
    let s = s.trim();
    URL_SAFE.decode(s).or_else(|_| URL_SAFE_NO_PAD.decode(s.trim_end_matches('='))).ok()
}

pub fn b64_standard(bytes: &[u8]) -> String {
    STANDARD.encode(bytes)
}

// ---------------------------------------------------------------------------
// Addresses
// ---------------------------------------------------------------------------

/// Split an address header on commas that are outside quotes and <>.
fn split_addresses(s: &str) -> Vec<String> {
    let mut out = vec![];
    let (mut cur, mut quoted, mut angle, mut escape) = (String::new(), false, false, false);
    for c in s.chars() {
        if escape {
            cur.push(c);
            escape = false;
            continue;
        }
        match c {
            '\\' if quoted => {
                escape = true;
                cur.push(c);
            }
            '"' => {
                quoted = !quoted;
                cur.push(c);
            }
            '<' if !quoted => {
                angle = true;
                cur.push(c);
            }
            '>' if !quoted => {
                angle = false;
                cur.push(c);
            }
            ',' | ';' if !quoted && !angle => {
                out.push(std::mem::take(&mut cur));
            }
            _ => cur.push(c),
        }
    }
    out.push(cur);
    out.into_iter().map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect()
}

pub fn parse_address(item: &str) -> Option<Address> {
    let item = item.trim();
    if let (Some(lt), Some(gt)) = (item.rfind('<'), item.rfind('>')) {
        if lt < gt {
            let email = item[lt + 1..gt].trim().to_string();
            let name = item[..lt].trim().trim_matches('"').replace("\\\"", "\"").trim().to_string();
            if email.contains('@') {
                return Some(Address { name: (!name.is_empty() && name != email).then_some(name), email });
            }
        }
    }
    let bare = item.trim_matches(|c| c == '<' || c == '>' || c == '"').trim();
    bare.contains('@').then(|| Address { name: None, email: bare.to_string() })
}

pub fn parse_address_list(s: Option<&str>) -> Vec<Address> {
    s.map(|s| split_addresses(s).iter().filter_map(|i| parse_address(i)).collect()).unwrap_or_default()
}

pub fn display_name(a: &Address) -> String {
    a.name.clone().unwrap_or_else(|| a.email.split('@').next().unwrap_or(&a.email).to_string())
}

// ---------------------------------------------------------------------------
// Snippets
// ---------------------------------------------------------------------------

/// Gmail snippets are HTML-escaped ("&#39;", "&amp;"). Decode the common forms.
pub fn decode_entities(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(i) = rest.find('&') {
        out.push_str(&rest[..i]);
        let tail = &rest[i..];
        // Look for ';' within the next few characters (char-boundary safe).
        if let Some(end) = tail.char_indices().take(12).find(|(_, c)| *c == ';').map(|(i, _)| i) {
            let ent = &tail[1..end];
            let decoded = match ent {
                "amp" => Some('&'),
                "lt" => Some('<'),
                "gt" => Some('>'),
                "quot" => Some('"'),
                "apos" => Some('\''),
                "nbsp" => Some(' '),
                _ if ent.starts_with("#x") || ent.starts_with("#X") => u32::from_str_radix(&ent[2..], 16).ok().and_then(char::from_u32),
                _ if ent.starts_with('#') => ent[1..].parse().ok().and_then(char::from_u32),
                _ => None,
            };
            if let Some(c) = decoded {
                out.push(c);
                rest = &tail[end + 1..];
                continue;
            }
        }
        out.push('&');
        rest = &tail[1..];
    }
    out.push_str(rest);
    out
}

// ---------------------------------------------------------------------------
// Thread summary (from format=metadata)
// ---------------------------------------------------------------------------

pub fn summarize(t: &RawThread, me: &str) -> Option<ThreadSummary> {
    let msgs: Vec<&RawMessage> = t.messages.iter().collect();
    msgs.first()?;
    // Ignore drafts when picking "who wrote last", but keep them for has_draft.
    let real: Vec<&&RawMessage> = msgs.iter().filter(|m| !m.has_label("DRAFT")).collect();
    let last = real.last().copied().copied().unwrap_or(msgs[msgs.len() - 1]);

    let subject = msgs
        .iter()
        .filter_map(|m| m.header("Subject"))
        .map(str::trim)
        .find(|s| !s.is_empty())
        .unwrap_or("")
        .to_string();

    let mut senders: Vec<String> = vec![];
    for m in &real {
        if let Some(a) = parse_address_list(m.header("From")).into_iter().next() {
            let n = if a.email.eq_ignore_ascii_case(me) { "me".to_string() } else { display_name(&a) };
            if !senders.contains(&n) {
                senders.push(n);
            }
        }
    }
    let from_last = parse_address_list(last.header("From")).into_iter().next().unwrap_or(Address { name: None, email: String::new() });
    // For the avatar, prefer the most recent sender who isn't me.
    let from = real
        .iter()
        .rev()
        .filter_map(|m| parse_address_list(m.header("From")).into_iter().next())
        .find(|a| !a.email.eq_ignore_ascii_case(me))
        .unwrap_or(from_last);

    let mut labels: Vec<String> = vec![];
    for m in &msgs {
        for l in &m.label_ids {
            if !labels.contains(l) {
                labels.push(l.clone());
            }
        }
    }
    let any = |l: &str| msgs.iter().any(|m| m.has_label(l));
    Some(ThreadSummary {
        id: t.id.clone(),
        history_id: t.history_id.clone(),
        subject,
        snippet: decode_entities(&last.snippet),
        senders,
        from,
        to: parse_address_list(last.header("To")),
        date: last.date_ms(),
        unread: any("UNREAD"),
        starred: any("STARRED"),
        important: any("IMPORTANT"),
        has_attachments: msgs.iter().any(|m| m.header("Content-Type").map(|c| c.to_ascii_lowercase().starts_with("multipart/mixed")).unwrap_or(false)),
        has_draft: any("DRAFT"),
        message_count: real.len().max(1) as u32,
        label_ids: labels,
        snoozed_until: None,
    })
}

// ---------------------------------------------------------------------------
// Full message bodies
// ---------------------------------------------------------------------------

#[derive(Debug, Default)]
pub struct ParsedBody {
    pub html: Option<String>,
    pub text: Option<String>,
    pub attachments: Vec<Attachment>,
    /// Content-ID → (attachment id or inline data, mime type)
    pub inline: HashMap<String, InlinePart>,
}

#[derive(Debug, Clone)]
pub enum InlinePart {
    Data(Vec<u8>, String),
    Remote(String, String),
}

fn charset_of(part: &Part) -> Option<String> {
    let ct = part.header("Content-Type")?;
    ct.split(';').skip(1).find_map(|p| {
        let (k, v) = p.split_once('=')?;
        k.trim().eq_ignore_ascii_case("charset").then(|| v.trim().trim_matches('"').to_string())
    })
}

pub fn decode_text(bytes: &[u8], charset: Option<&str>) -> String {
    let enc = charset
        .and_then(|c| encoding_rs::Encoding::for_label(c.as_bytes()))
        .unwrap_or(encoding_rs::UTF_8);
    enc.decode(bytes).0.into_owned()
}

fn is_attachment(part: &Part) -> bool {
    let disp = part.header("Content-Disposition").unwrap_or("").to_ascii_lowercase();
    !part.filename.is_empty() || disp.starts_with("attachment")
}

pub fn parse_body(msg: &RawMessage) -> ParsedBody {
    let mut out = ParsedBody::default();
    if let Some(p) = &msg.payload {
        walk(p, &msg.id, &mut out);
    }
    out
}

fn walk(part: &Part, message_id: &str, out: &mut ParsedBody) {
    let mime = part.mime_type.to_ascii_lowercase();
    if mime.starts_with("multipart/") {
        for p in &part.parts {
            walk(p, message_id, out);
        }
        return;
    }
    let content_id = part.header("Content-ID").map(|c| c.trim().trim_start_matches('<').trim_end_matches('>').to_string());
    let disp = part.header("Content-Disposition").unwrap_or("").to_ascii_lowercase();

    if !is_attachment(part) && (mime == "text/html" || mime == "text/plain") {
        if let Some(bytes) = part.body.data.as_deref().and_then(b64url_decode) {
            let text = decode_text(&bytes, charset_of(part).as_deref());
            let slot = if mime == "text/html" { &mut out.html } else { &mut out.text };
            match slot {
                Some(existing) => {
                    existing.push('\n');
                    existing.push_str(&text);
                }
                None => *slot = Some(text),
            }
        }
        return;
    }

    if let Some(cid) = &content_id {
        if mime.starts_with("image/") {
            let entry = match (&part.body.data, &part.body.attachment_id) {
                (Some(d), _) => b64url_decode(d).map(|b| InlinePart::Data(b, mime.clone())),
                (None, Some(id)) => Some(InlinePart::Remote(id.clone(), mime.clone())),
                _ => None,
            };
            if let Some(e) = entry {
                out.inline.insert(cid.clone(), e);
            }
        }
    }

    if let Some(att_id) = &part.body.attachment_id {
        let inline = content_id.is_some() && !disp.starts_with("attachment");
        let filename = if part.filename.is_empty() { "attachment".to_string() } else { part.filename.clone() };
        out.attachments.push(Attachment {
            id: att_id.clone(),
            message_id: message_id.to_string(),
            filename,
            mime_type: if mime.is_empty() { "application/octet-stream".into() } else { mime },
            size: part.body.size,
            inline,
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::gmail::api::{Body, Header};

    fn h(n: &str, v: &str) -> Header {
        Header { name: n.into(), value: v.into() }
    }

    #[test]
    fn parses_tricky_address_lists() {
        let l = parse_address_list(Some(r#""Doe, Jane" <jane@x.com>, bob@y.org, Ann Lee <ann@z.io>; <solo@q.net>"#));
        assert_eq!(l.len(), 4);
        assert_eq!(l[0].name.as_deref(), Some("Doe, Jane"));
        assert_eq!(l[0].email, "jane@x.com");
        assert_eq!(l[1], Address { name: None, email: "bob@y.org".into() });
        assert_eq!(l[2].name.as_deref(), Some("Ann Lee"));
        assert_eq!(l[3].email, "solo@q.net");
        assert!(parse_address_list(Some("undisclosed-recipients:;")).is_empty());
    }

    #[test]
    fn decodes_snippet_entities() {
        assert_eq!(decode_entities("It&#39;s &quot;fine&quot; &amp; ok &#x263A; &bogus;"), "It's \"fine\" & ok ☺ &bogus;");
    }

    #[test]
    fn decodes_non_utf8_charsets() {
        assert_eq!(decode_text(&[0x63, 0x61, 0x66, 0xe9], Some("iso-8859-1")), "café");
    }

    #[test]
    fn walks_multipart_with_attachments_and_inline_images() {
        let enc = |s: &str| URL_SAFE.encode(s);
        let payload = Part {
            mime_type: "multipart/mixed".into(),
            parts: vec![
                Part {
                    mime_type: "multipart/alternative".into(),
                    parts: vec![
                        Part { mime_type: "text/plain".into(), headers: vec![h("Content-Type", "text/plain; charset=UTF-8")], body: Body { data: Some(enc("hi")), ..Default::default() }, ..Default::default() },
                        Part { mime_type: "text/html".into(), body: Body { data: Some(enc("<b>hi</b>")), ..Default::default() }, ..Default::default() },
                    ],
                    ..Default::default()
                },
                Part { mime_type: "image/png".into(), filename: "logo.png".into(), headers: vec![h("Content-ID", "<logo1>"), h("Content-Disposition", "inline")], body: Body { attachment_id: Some("A1".into()), size: 10, data: None }, ..Default::default() },
                Part { mime_type: "application/pdf".into(), filename: "q3.pdf".into(), headers: vec![h("Content-Disposition", "attachment; filename=q3.pdf")], body: Body { attachment_id: Some("A2".into()), size: 2048, data: None }, ..Default::default() },
            ],
            ..Default::default()
        };
        let msg = RawMessage { id: "m1".into(), thread_id: "t".into(), label_ids: vec![], snippet: String::new(), internal_date: "0".into(), payload: Some(payload) };
        let b = parse_body(&msg);
        assert_eq!(b.html.as_deref(), Some("<b>hi</b>"));
        assert_eq!(b.text.as_deref(), Some("hi"));
        assert_eq!(b.attachments.len(), 2);
        assert!(b.attachments[0].inline);
        assert!(!b.attachments[1].inline);
        assert!(b.inline.contains_key("logo1"));
    }

    #[test]
    fn summarises_thread() {
        let mk = |id: &str, from: &str, labels: &[&str], date: &str| RawMessage {
            id: id.into(),
            thread_id: "t1".into(),
            label_ids: labels.iter().map(|s| s.to_string()).collect(),
            snippet: format!("snippet {id}"),
            internal_date: date.into(),
            payload: Some(Part { headers: vec![h("From", from), h("Subject", "Plans"), h("Content-Type", "multipart/mixed; boundary=x")], ..Default::default() }),
        };
        let t = RawThread {
            id: "t1".into(),
            history_id: "9".into(),
            messages: vec![mk("a", "Ann <ann@x.com>", &["INBOX"], "100"), mk("b", "Me <me@x.com>", &["SENT", "STARRED"], "200"), mk("c", "Me <me@x.com>", &["DRAFT"], "300")],
        };
        let s = summarize(&t, "me@x.com").unwrap();
        assert_eq!(s.senders, vec!["Ann", "me"]);
        assert_eq!(s.from.email, "ann@x.com");
        assert_eq!(s.date, 200);
        assert!(s.starred && s.has_draft && s.has_attachments && !s.unread);
        assert_eq!(s.message_count, 2);
        assert_eq!(s.snippet, "snippet b");
    }
}
