// Builds the document shown inside the sandboxed email <iframe>.
// The HTML has already been sanitised in Rust; this adds a strict CSP as a
// second layer and a small base stylesheet for readable defaults.

import geistUrl from "@fontsource-variable/geist/files/geist-latin-wght-normal.woff2?url";

export interface FrameTheme {
  /** "paper" keeps the sender's design on a light card; "app" adopts Vela's colours (plain text). */
  mode: "paper" | "app";
  text: string;
  muted: string;
  link: string;
  background: string;
  quoteBorder: string;
}

export function frameDocument(body: string, css: string, allowRemote: boolean, t: FrameTheme): string {
  const img = allowRemote ? "data: https: http:" : "data:";
  const csp = [
    "default-src 'none'",
    `img-src ${img}`,
    "style-src 'unsafe-inline'",
    "font-src 'self' data:",
    "media-src 'none'",
    "frame-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join("; ");

  const base = `
    @font-face { font-family: "Geist Variable"; src: url("${geistUrl}") format("woff2"); font-weight: 100 900; }
    html { -webkit-text-size-adjust: 100%; overflow-y: hidden; }
    body {
      margin: 0; padding: ${t.mode === "paper" ? "20px 24px" : "2px 0"};
      color: ${t.text}; background: ${t.background};
      font: 14px/1.6 "Geist Variable", ui-sans-serif, system-ui, sans-serif;
      overflow-wrap: anywhere; word-break: normal;
    }
    img { max-width: 100%; height: auto; }
    table { max-width: 100%; }
    a { color: ${t.link}; }
    pre, code { white-space: pre-wrap; }
    blockquote { margin: 0 0 0 .8ex; padding-left: 1ex; border-left: 2px solid ${t.quoteBorder}; color: ${t.muted}; }
    .vela-plain { white-space: pre-wrap; font: inherit; }
    .vela-plain-quote { white-space: pre-wrap; }
    details.vela-quote > summary {
      list-style: none; cursor: pointer; display: inline-flex; align-items: center; justify-content: center;
      width: 30px; height: 16px; margin: 8px 0; border-radius: 8px; font-size: 12px; line-height: 1; letter-spacing: 1px;
      color: ${t.muted}; background: color-mix(in srgb, ${t.muted} 18%, transparent);
    }
    details.vela-quote > summary::-webkit-details-marker { display: none; }
    details.vela-quote > summary:hover { background: color-mix(in srgb, ${t.muted} 30%, transparent); }
  `;

  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="referrer" content="no-referrer">
<meta name="color-scheme" content="${t.mode === "paper" ? "light" : "light dark"}">
<style>${base}</style><style>${css}</style></head><body>${body}</body></html>`;
}

/** Wrap quoted history in a collapsible <details> (works without scripts). */
export function collapseQuotes(doc: Document) {
  const selectors = [
    "div.gmail_quote",
    "blockquote[type=cite]",
    "div.yahoo_quoted",
    "#divRplyFwdMsg",
    "div#appendonsend",
    "blockquote.vela-plain-quote",
  ];
  const nodes = doc.querySelectorAll<HTMLElement>(selectors.join(","));
  nodes.forEach((el) => {
    if (el.closest("details.vela-quote")) return;
    // Outlook: hide the separator and everything after it.
    const details = doc.createElement("details");
    details.className = "vela-quote";
    const summary = doc.createElement("summary");
    summary.textContent = "•••";
    summary.title = "Show quoted text";
    details.appendChild(summary);
    el.replaceWith(details);
    details.appendChild(el);
    if (el.id === "divRplyFwdMsg" || el.id === "appendonsend") {
      let next = details.nextSibling;
      while (next) {
        const after = next.nextSibling;
        details.appendChild(next);
        next = after;
      }
    }
  });
}

/**
 * Designed emails (tables, backgrounds, their own colours) keep their look on a
 * light "paper" card. Simple text-like HTML adopts Vela's theme instead.
 */
export function isDesignedEmail(html: string, css: string): boolean {
  if (css.trim()) return true;
  return /<table|bgcolor=|background(-color)?\s*:|<img|\scolor\s*:|<font[^>]+color|<center|<hr/i.test(html);
}
