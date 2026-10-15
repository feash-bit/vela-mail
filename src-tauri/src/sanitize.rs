//! Email HTML sanitiser. Incoming mail is untrusted, so this runs in Rust
//! before anything reaches the web view. It is one of three layers:
//!
//! 1. This module: an allow-list sanitiser (ammonia) that drops scripts, event
//!    handlers, forms, frames, `<base>`, `<meta>`, `javascript:` URLs, and —
//!    unless the user allows it — every remote URL (tracking pixels, remote CSS
//!    `url()` and `@import`, `srcset`).
//! 2. The UI renders the result in an `<iframe sandbox>` with scripts disabled.
//! 3. That frame carries its own Content-Security-Policy (`default-src 'none'`).

use regex::Regex;
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, LazyLock};

static STYLE_BLOCK: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?is)<style\b[^>]*>(.*?)</style\s*>").unwrap());
static CSS_URL: LazyLock<Regex> = LazyLock::new(|| Regex::new(r#"(?i)url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)"#).unwrap());
static CSS_IMPORT: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)@import[^;]*;?").unwrap());
static CSS_DANGER: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)(expression\s*\(|javascript\s*:|vbscript\s*:|behavior\s*:|-moz-binding|@charset)").unwrap()
});
static CSS_POSITION_FIXED: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)position\s*:\s*(fixed|sticky)").unwrap());

pub struct Sanitized {
    pub css: String,
    pub body: String,
    pub blocked_remote: u32,
}

fn is_remote(url: &str) -> bool {
    let u = url.trim().to_ascii_lowercase();
    u.starts_with("http://") || u.starts_with("https://") || u.starts_with("//")
}

fn is_safe_data_image(url: &str) -> bool {
    let u = url.trim().to_ascii_lowercase();
    ["data:image/png", "data:image/jpeg", "data:image/jpg", "data:image/gif", "data:image/webp", "data:image/bmp"]
        .iter()
        .any(|p| u.starts_with(p))
}

/// Resolve an image URL: keep safe data URIs, map `cid:` to inline data,
/// keep remote URLs only when allowed. `None` drops the attribute.
fn resolve_image(url: &str, allow_remote: bool, cids: &HashMap<String, String>, blocked: &AtomicU32) -> Option<String> {
    let t = url.trim();
    if is_safe_data_image(t) {
        return Some(t.to_string());
    }
    if let Some(cid) = t.strip_prefix("cid:").or_else(|| t.strip_prefix("CID:")) {
        return cids.get(cid.trim()).cloned();
    }
    if is_remote(t) {
        if allow_remote {
            return Some(if t.starts_with("//") { format!("https:{t}") } else { t.to_string() });
        }
        blocked.fetch_add(1, Ordering::Relaxed);
    }
    None
}

pub fn sanitize_css(css: &str, allow_remote: bool, cids: &HashMap<String, String>, blocked: &AtomicU32) -> String {
    let css = CSS_IMPORT.replace_all(css, "");
    let css = CSS_DANGER.replace_all(&css, "/*x*/");
    // Fixed/sticky elements could overlay Vela-looking UI inside the frame.
    let css = CSS_POSITION_FIXED.replace_all(&css, "position:static");
    let css = CSS_URL.replace_all(&css, |c: &regex::Captures| {
        let raw = c.get(1).or(c.get(2)).or(c.get(3)).map(|m| m.as_str()).unwrap_or("");
        match resolve_image(raw, allow_remote, cids, blocked) {
            Some(u) => format!("url(\"{}\")", u.replace(['"', '\\', '\n', '\r'], "")),
            None => "none".to_string(),
        }
    });
    // Never allow the stylesheet to close its own <style> element.
    css.replace("</", "<\\/").replace("<!--", "").replace("-->", "")
}

pub fn sanitize_email_html(html: &str, allow_remote: bool, cids: HashMap<String, String>) -> Sanitized {
    let blocked = Arc::new(AtomicU32::new(0));
    let cids = Arc::new(cids);

    // Pull out <style> blocks first so ammonia (which removes them) doesn't lose layout.
    let mut css = String::new();
    for cap in STYLE_BLOCK.captures_iter(html) {
        css.push_str(&sanitize_css(&cap[1], allow_remote, &cids, &blocked));
        css.push('\n');
    }
    let without_styles = STYLE_BLOCK.replace_all(html, "");

    let mut b = ammonia::Builder::default();
    b.add_tags(&["font", "center", "details", "summary", "big", "small", "u", "s", "strike", "tt", "section", "article", "header", "footer", "main", "nav", "aside", "figure", "figcaption", "wbr"])
        .add_generic_attributes(&[
            "style", "class", "align", "valign", "width", "height", "bgcolor", "color", "dir", "border",
            "cellpadding", "cellspacing", "face", "size", "background", "role", "title", "lang", "nowrap",
        ])
        .add_tag_attributes("a", &["href", "title", "name"])
        .add_tag_attributes("img", &["src", "alt", "width", "height", "border", "align", "hspace", "vspace"])
        .add_tag_attributes("td", &["colspan", "rowspan"])
        .add_tag_attributes("th", &["colspan", "rowspan"])
        .add_tag_attributes("table", &["summary"])
        .add_tag_attributes("ol", &["start", "type"])
        .url_schemes(HashSet::from(["http", "https", "mailto", "data", "cid"]))
        .url_relative(ammonia::UrlRelative::Deny)
        .link_rel(Some("noopener noreferrer"))
        .add_clean_content_tags(&["title", "noscript", "template"])
        .strip_comments(true);

    let (blocked_f, cids_f) = (blocked.clone(), cids.clone());
    b.attribute_filter(move |element, attribute, value| {
        match (element, attribute) {
            (_, "style") => Some(sanitize_css(value, allow_remote, &cids_f, &blocked_f).into()),
            ("img", "src") | (_, "background") => resolve_image(value, allow_remote, &cids_f, &blocked_f).map(Into::into),
            ("a", "href") => {
                let v = value.trim().to_ascii_lowercase();
                (v.starts_with("http://") || v.starts_with("https://") || v.starts_with("mailto:")).then(|| value.into())
            }
            _ => Some(value.into()),
        }
    });

    let body = b.clean(&without_styles).to_string();
    Sanitized { css, body, blocked_remote: blocked.load(Ordering::Relaxed) }
}

/// Plain-text email → safe HTML with clickable links and quoted blocks.
pub fn plain_to_html(text: &str) -> String {
    let finder = linkify::LinkFinder::new();
    let linkify_line = |line: &str| -> String {
        let mut out = String::new();
        for span in finder.spans(line) {
            let esc = escape(span.as_str());
            match span.kind() {
                Some(linkify::LinkKind::Url) if is_remote(span.as_str()) => {
                    out.push_str(&format!("<a href=\"{esc}\" rel=\"noopener noreferrer\">{esc}</a>"))
                }
                Some(linkify::LinkKind::Email) => out.push_str(&format!("<a href=\"mailto:{esc}\">{esc}</a>")),
                _ => out.push_str(&esc),
            }
        }
        out
    };
    let mut html = String::from("<div class=\"vela-plain\">");
    let mut in_quote = false;
    for line in text.replace("\r\n", "\n").split('\n') {
        let quoted = line.trim_start().starts_with('>');
        if quoted && !in_quote {
            html.push_str("<blockquote class=\"vela-plain-quote\">");
            in_quote = true;
        } else if !quoted && in_quote {
            html.push_str("</blockquote>");
            in_quote = false;
        }
        let content = if quoted { line.trim_start().trim_start_matches('>').trim_start_matches(' ') } else { line };
        html.push_str(&linkify_line(content));
        html.push('\n');
    }
    if in_quote {
        html.push_str("</blockquote>");
    }
    html.push_str("</div>");
    html
}

pub fn escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;").replace('\'', "&#39;")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn clean(html: &str, remote: bool) -> Sanitized {
        sanitize_email_html(html, remote, HashMap::new())
    }

    #[test]
    fn strips_scripts_handlers_and_dangerous_urls() {
        let s = clean(
            r#"<script>alert(1)</script><img src=x onerror=alert(1)><a href="javascript:alert(1)">x</a>
               <iframe src="https://evil"></iframe><form action="https://evil"><input></form>
               <svg onload=alert(1)></svg><meta http-equiv="refresh" content="0;url=https://evil"><base href="https://evil/">
               <a href="https://ok.example/path">ok</a>"#,
            false,
        );
        let b = s.body.to_lowercase();
        for bad in ["<script", "onerror", "javascript:", "<iframe", "<form", "<input", "onload", "<meta", "<base"] {
            assert!(!b.contains(bad), "{bad} survived: {b}");
        }
        assert!(b.contains("href=\"https://ok.example/path\""));
        assert!(b.contains("noopener"));
    }

    #[test]
    fn blocks_remote_images_and_css_unless_allowed() {
        let html = r#"<style>@import url(https://t.example/a.css); body{background:url('https://t.example/p.gif')}</style>
                      <img src="https://t.example/pixel.gif" width=1><div style="background-image:url(//t.example/b.png)">x</div>"#;
        let s = clean(html, false);
        assert_eq!(s.blocked_remote, 3);
        assert!(!s.body.contains("t.example") && !s.css.contains("t.example"), "{} {}", s.body, s.css);
        assert!(!s.css.contains("@import"));
        let s = clean(html, true);
        assert_eq!(s.blocked_remote, 0);
        assert!(s.body.contains("https://t.example/pixel.gif"));
        assert!(s.body.contains("https://t.example/b.png"));
    }

    #[test]
    fn style_blocks_cannot_break_out() {
        let s = clean("<style>a{color:red}</style><script>x</script>", false);
        assert!(!s.css.contains("</"));
        let s = clean("<style>a{}</style ><p>hi</p>", false);
        assert!(s.body.contains("<p>hi</p>"));
        let s = sanitize_css("x{} </style><script>alert(1)</script>", false, &HashMap::new(), &AtomicU32::new(0));
        assert!(!s.contains("</style"));
        let s = sanitize_css("div{width:expression(alert(1));position:fixed}", false, &HashMap::new(), &AtomicU32::new(0));
        assert!(!s.contains("expression(") && !s.contains("fixed"));
    }

    #[test]
    fn maps_cid_images_and_rejects_svg_data() {
        let cids = HashMap::from([("logo@x".to_string(), "data:image/png;base64,AAAA".to_string())]);
        let s = sanitize_email_html(r#"<img src="cid:logo@x"><img src="data:image/svg+xml;base64,PHN2Zz4="><img src="cid:missing">"#, false, cids);
        assert!(s.body.contains("data:image/png;base64,AAAA"));
        assert!(!s.body.contains("svg+xml"));
    }

    #[test]
    fn plain_text_is_escaped_linkified_and_quotes_grouped() {
        let h = plain_to_html("Hi <b>you</b>\nsee https://example.com/x?a=1&b=2\n> quoted\n> more\nbye");
        assert!(h.contains("&lt;b&gt;you&lt;/b&gt;"));
        assert!(h.contains(r#"<a href="https://example.com/x?a=1&amp;b=2""#));
        assert_eq!(h.matches("<blockquote").count(), 1);
    }
}
