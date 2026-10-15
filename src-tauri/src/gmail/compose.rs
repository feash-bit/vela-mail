//! Builds RFC 5322 / MIME messages for sending and drafts.

use crate::error::{AppError, AppResult};
use crate::models::Address;
use mail_builder::headers::address::Address as MbAddress;
use mail_builder::MessageBuilder;

/// Gmail's limit for attachments in a sent message.
pub const MAX_ATTACHMENT_BYTES: u64 = 25 * 1024 * 1024;

pub struct OutAttachment {
    pub filename: String,
    pub mime_type: String,
    pub data: Vec<u8>,
}

pub struct Outgoing<'a> {
    pub from: &'a Address,
    pub to: &'a [Address],
    pub cc: &'a [Address],
    pub bcc: &'a [Address],
    pub subject: &'a str,
    pub html: &'a str,
    pub text: &'a str,
    pub in_reply_to: Option<&'a str>,
    pub references: Option<&'a str>,
    pub attachments: Vec<OutAttachment>,
}

fn strip_id(s: &str) -> String {
    s.trim().trim_start_matches('<').trim_end_matches('>').to_string()
}

fn valid_email(e: &str) -> bool {
    let e = e.trim();
    let mut parts = e.splitn(2, '@');
    let (local, domain) = (parts.next().unwrap_or(""), parts.next().unwrap_or(""));
    !local.is_empty()
        && domain.contains('.')
        && !domain.starts_with('.')
        && !domain.ends_with('.')
        && !e.chars().any(|c| c.is_whitespace() || c.is_control() || matches!(c, '<' | '>' | ',' | ';' | '"' | '\\'))
}

fn to_list(list: &[Address]) -> AppResult<Option<MbAddress<'static>>> {
    if list.is_empty() {
        return Ok(None);
    }
    let mut items = vec![];
    for a in list {
        if !valid_email(&a.email) {
            return Err(AppError::Invalid(format!("\"{}\" isn't a valid email address.", a.email)));
        }
        // Names can't smuggle extra headers: control characters are removed.
        let name = a.name.as_ref().map(|n| n.chars().filter(|c| !c.is_control()).collect::<String>()).filter(|n| !n.trim().is_empty());
        items.push(MbAddress::new_address(name, a.email.trim().to_string()));
    }
    Ok(Some(MbAddress::new_list(items)))
}

pub fn build(m: Outgoing) -> AppResult<Vec<u8>> {
    let total: u64 = m.attachments.iter().map(|a| a.data.len() as u64).sum();
    if total > MAX_ATTACHMENT_BYTES {
        return Err(AppError::Invalid("Attachments are larger than Gmail's 25 MB limit. Remove some files or share a link instead.".into()));
    }
    // Control characters (CR/LF) become spaces so a subject can't start a new header.
    let subject: String = m.subject.chars().map(|c| if c.is_control() { ' ' } else { c }).collect();
    let mut b = MessageBuilder::new()
        .from(MbAddress::new_address(m.from.name.clone().filter(|n| !n.is_empty()), m.from.email.clone()))
        .subject(subject)
        .text_body(m.text.to_string())
        .html_body(m.html.to_string());
    if let Some(a) = to_list(m.to)? {
        b = b.to(a);
    }
    if let Some(a) = to_list(m.cc)? {
        b = b.cc(a);
    }
    if let Some(a) = to_list(m.bcc)? {
        b = b.bcc(a);
    }
    if let Some(id) = m.in_reply_to.filter(|s| !s.trim().is_empty()) {
        b = b.in_reply_to(strip_id(id));
    }
    if let Some(refs) = m.references.filter(|s| !s.trim().is_empty()) {
        let ids: Vec<String> = refs.split_whitespace().map(strip_id).filter(|s| !s.is_empty()).collect();
        if !ids.is_empty() {
            b = b.references(ids);
        }
    }
    for a in m.attachments {
        let name: String = a.filename.chars().filter(|c| !c.is_control() && *c != '/' && *c != '\\').collect();
        b = b.attachment(a.mime_type, name, a.data);
    }
    b.write_to_vec().map_err(AppError::internal)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn addr(n: Option<&str>, e: &str) -> Address {
        Address { name: n.map(Into::into), email: e.into() }
    }

    #[test]
    fn builds_reply_with_attachment() {
        let from = addr(Some("Stu"), "me@example.com");
        let raw = build(Outgoing {
            from: &from,
            to: &[addr(Some("Ann Lee"), "ann@example.com")],
            cc: &[],
            bcc: &[addr(None, "secret@example.com")],
            subject: "Re: Plans\r\nBcc: injected@evil.com",
            html: "<p>Hello</p>",
            text: "Hello",
            in_reply_to: Some("<orig@mail.gmail.com>"),
            references: Some("<a@x> <orig@mail.gmail.com>"),
            attachments: vec![OutAttachment { filename: "notes.txt".into(), mime_type: "text/plain".into(), data: b"hi".to_vec() }],
        })
        .unwrap();
        let s = String::from_utf8_lossy(&raw);
        assert!(s.contains("In-Reply-To: <orig@mail.gmail.com>"));
        assert!(s.contains("References: <a@x>"));
        assert!(s.contains("multipart/mixed"));
        assert!(s.contains("notes.txt"));
        assert!(s.contains("Bcc: <secret@example.com>") || s.contains("Bcc: secret@example.com"));
        assert!(!s.lines().any(|l| l.starts_with("Bcc: injected")), "header injection via subject: {s}");
        assert!(s.contains("Subject: Re: Plans  Bcc: injected@evil.com"));
    }

    #[test]
    fn rejects_bad_addresses_and_oversize() {
        let from = addr(None, "me@example.com");
        let base = |to: Vec<Address>, att: Vec<OutAttachment>| {
            build(Outgoing { from: &from, to: &to, cc: &[], bcc: &[], subject: "", html: "", text: "", in_reply_to: None, references: None, attachments: att })
        };
        assert!(base(vec![addr(None, "not an email")], vec![]).is_err());
        assert!(base(vec![addr(None, "a@b.co\r\nBcc: x@y.z")], vec![]).is_err());
        let big = OutAttachment { filename: "big.bin".into(), mime_type: "application/octet-stream".into(), data: vec![0; (MAX_ATTACHMENT_BYTES + 1) as usize] };
        assert!(base(vec![addr(None, "a@b.co")], vec![big]).is_err());
        assert!(base(vec![], vec![]).is_ok(), "drafts may have no recipients");
    }
}
