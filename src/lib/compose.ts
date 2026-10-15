// Builds the starting state for replies and forwards (recipients, subject,
// quoted text, threading headers). Pure functions so they can be tested.

import { escapeHtml, fullDate, nameOf } from "./format";
import type { Address, ForwardedAttachment, LocalFile, Message } from "./types";

export type ComposeMode = "new" | "reply" | "replyAll" | "forward" | "draft";

export interface ComposeSeed {
  mode: ComposeMode;
  threadId: string | null;
  draftId: string | null;
  to: Address[];
  cc: Address[];
  bcc: Address[];
  subject: string;
  /** Editable body (HTML). */
  body: string;
  /** Quoted original, appended when sending; not edited in the editor. */
  quote: string | null;
  inReplyTo: string | null;
  references: string | null;
  forwarded: ForwardedAttachment[];
  /** Local files already attached (e.g. when reopening a draft). */
  files: LocalFile[];
}

const sameEmail = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

function dedupe(list: Address[], exclude: string[]): Address[] {
  const seen = new Set(exclude.map((e) => e.toLowerCase()));
  const out: Address[] = [];
  for (const a of list) {
    const k = a.email.toLowerCase();
    if (!a.email || seen.has(k)) continue;
    seen.add(k);
    out.push(a);
  }
  return out;
}

export function prefixSubject(subject: string, prefix: "Re" | "Fwd"): string {
  const s = subject.trim() || "(no subject)";
  const re = prefix === "Re" ? /^(re|aw|sv|vs)\s*:/i : /^(fwd?|wg)\s*:/i;
  return re.test(s) ? s : `${prefix}: ${s}`;
}

export function quoteBlock(m: Message, intro: string): string {
  return (
    `<div class="gmail_quote"><div class="gmail_attr">${escapeHtml(intro)}</div>` +
    `<blockquote class="gmail_quote" style="margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex">${m.html}</blockquote></div>`
  );
}

export function replySeed(m: Message, me: string, all: boolean): ComposeSeed {
  const fromMe = sameEmail(m.from.email, me);
  // Replying to your own message goes to its original recipients.
  const primary = fromMe ? m.to : m.replyTo.length ? m.replyTo : [m.from];
  const to = dedupe(primary, fromMe ? [] : [me]);
  const cc = all ? dedupe([...(fromMe ? [] : m.to), ...m.cc], [me, ...to.map((a) => a.email)]) : [];
  const refs = [m.references, m.messageIdHeader].filter(Boolean).join(" ").trim() || null;
  return {
    mode: all ? "replyAll" : "reply",
    threadId: m.threadId,
    draftId: null,
    to,
    cc,
    bcc: [],
    subject: prefixSubject(m.subject, "Re"),
    body: "",
    quote: quoteBlock(m, `On ${fullDate(m.date)}, ${nameOf(m.from)} <${m.from.email}> wrote:`),
    inReplyTo: m.messageIdHeader,
    references: refs,
    forwarded: [],
    files: [],
  };
}

export function forwardSeed(m: Message): ComposeSeed {
  const list = (a: Address[]) => a.map((x) => (x.name ? `${x.name} <${x.email}>` : x.email)).join(", ");
  const header = [
    "---------- Forwarded message ---------",
    `From: ${m.from.name ? `${m.from.name} <${m.from.email}>` : m.from.email}`,
    `Date: ${fullDate(m.date)}`,
    `Subject: ${m.subject}`,
    `To: ${list(m.to)}`,
    ...(m.cc.length ? [`Cc: ${list(m.cc)}`] : []),
  ]
    .map(escapeHtml)
    .join("<br>");
  return {
    mode: "forward",
    threadId: m.threadId,
    draftId: null,
    to: [],
    cc: [],
    bcc: [],
    subject: prefixSubject(m.subject, "Fwd"),
    body: "",
    quote: `<div class="gmail_quote"><div class="gmail_attr">${header}</div><br>${m.html}</div>`,
    inReplyTo: null,
    references: null,
    forwarded: m.attachments
      .filter((a) => !a.inline)
      .map((a) => ({ messageId: a.messageId, attachmentId: a.id, filename: a.filename, mimeType: a.mimeType })),
    files: [],
  };
}

export function newSeed(partial: Partial<ComposeSeed> = {}): ComposeSeed {
  return {
    mode: "new",
    threadId: null,
    draftId: null,
    to: [],
    cc: [],
    bcc: [],
    subject: "",
    body: "",
    quote: null,
    inReplyTo: null,
    references: null,
    forwarded: [],
    files: [],
    ...partial,
  };
}

/** Parse a mailto: URL (RFC 6068) into a compose seed. */
export function mailtoSeed(url: string): ComposeSeed {
  const rest = url.replace(/^mailto:/i, "");
  const [path, query = ""] = rest.split("?");
  const params = new URLSearchParams(query);
  const get = (k: string) => {
    for (const [key, v] of params) if (key.toLowerCase() === k) return v;
    return "";
  };
  const addrs = (s: string) =>
    s
      .split(",")
      .map((x) => decodeURIComponent(x).trim())
      .filter((x) => x.includes("@"))
      .map((email) => ({ name: null, email }));
  const body = get("body");
  return newSeed({
    to: addrs([decodeURIComponent(path), get("to")].filter(Boolean).join(",")),
    cc: addrs(get("cc")),
    bcc: addrs(get("bcc")),
    subject: get("subject").slice(0, 500),
    body: body ? `<p>${escapeHtml(body).replace(/\r?\n/g, "<br>")}</p>` : "",
  });
}

/** Split a saved draft into the editable part and the quoted original. */
export function splitDraftHtml(html: string): { body: string; quote: string | null } {
  const i = html.search(/<div[^>]*class="[^"]*gmail_quote/i);
  if (i < 0) return { body: html, quote: null };
  return { body: html.slice(0, i), quote: html.slice(i) };
}
