import { describe, expect, it } from "vitest";
import { forwardSeed, mailtoSeed, prefixSubject, replySeed, splitDraftHtml } from "./compose";
import type { Message } from "./types";

const msg = (over: Partial<Message> = {}): Message => ({
  id: "m1",
  threadId: "t1",
  from: { name: "Ann Lee", email: "ann@x.com" },
  to: [{ name: "Me", email: "me@x.com" }, { name: "Bob", email: "bob@x.com" }],
  cc: [{ name: null, email: "carol@x.com" }],
  bcc: [],
  replyTo: [],
  subject: "Plans",
  date: Date.UTC(2026, 9, 14, 3, 0),
  snippet: "",
  labelIds: [],
  unread: false,
  starred: false,
  isDraft: false,
  html: "<p>Hello</p>",
  css: "",
  plainText: false,
  blockedRemote: 0,
  attachments: [{ id: "a1", messageId: "m1", filename: "q3.pdf", mimeType: "application/pdf", size: 10, inline: false }],
  messageIdHeader: "<id1@mail>",
  references: "<id0@mail>",
  listUnsubscribe: null,
  ...over,
});

describe("compose seeds", () => {
  it("prefixes subjects once", () => {
    expect(prefixSubject("Plans", "Re")).toBe("Re: Plans");
    expect(prefixSubject("RE: Plans", "Re")).toBe("RE: Plans");
    expect(prefixSubject("Fw: x", "Fwd")).toBe("Fw: x");
    expect(prefixSubject("", "Re")).toBe("Re: (no subject)");
  });

  it("reply goes to sender; reply all adds others but never me", () => {
    const r = replySeed(msg(), "ME@x.com", false);
    expect(r.to.map((a) => a.email)).toEqual(["ann@x.com"]);
    expect(r.cc).toEqual([]);
    expect(r.references).toBe("<id0@mail> <id1@mail>");
    expect(r.inReplyTo).toBe("<id1@mail>");
    const all = replySeed(msg(), "me@x.com", true);
    expect(all.cc.map((a) => a.email)).toEqual(["bob@x.com", "carol@x.com"]);
  });

  it("respects Reply-To and replies to own messages' recipients", () => {
    expect(replySeed(msg({ replyTo: [{ name: null, email: "list@x.com" }] }), "me@x.com", false).to[0].email).toBe("list@x.com");
    const own = replySeed(msg({ from: { name: "Me", email: "me@x.com" }, to: [{ name: null, email: "zed@x.com" }] }), "me@x.com", false);
    expect(own.to.map((a) => a.email)).toEqual(["zed@x.com"]);
  });

  it("forward carries attachments and escapes the header", () => {
    const f = forwardSeed(msg({ subject: "<script>" }));
    expect(f.forwarded).toHaveLength(1);
    expect(f.quote).toContain("&lt;script&gt;");
    expect(f.subject).toBe("Fwd: <script>");
  });

  it("parses mailto links", () => {
    const s = mailtoSeed("mailto:ann@x.com,bob@x.com?subject=Hi%20there&cc=c@x.com&body=Line1%0ALine2");
    expect(s.to.map((a) => a.email)).toEqual(["ann@x.com", "bob@x.com"]);
    expect(s.cc[0].email).toBe("c@x.com");
    expect(s.subject).toBe("Hi there");
    expect(s.body).toBe("<p>Line1<br>Line2</p>");
  });

  it("splits drafts at the quote", () => {
    expect(splitDraftHtml('<p>Hi</p><div class="gmail_quote">old</div>')).toEqual({ body: "<p>Hi</p>", quote: '<div class="gmail_quote">old</div>' });
    expect(splitDraftHtml("<p>Hi</p>").quote).toBeNull();
  });
});
