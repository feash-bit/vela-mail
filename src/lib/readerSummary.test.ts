import { describe, expect, it } from "vitest";
import { summaryFromDetail } from "./readerSummary";
import type { Message, ThreadDetail } from "./types";

const msg = (id: string, from: string, over: Partial<Message> = {}): Message => ({
  id,
  threadId: "t1",
  from: { name: from, email: `${from.toLowerCase()}@example.com` },
  to: [{ name: null, email: "me@example.com" }],
  cc: [],
  bcc: [],
  replyTo: [],
  subject: "Hello",
  date: 1000,
  snippet: `snippet ${id}`,
  labelIds: [],
  unread: false,
  starred: false,
  isDraft: false,
  html: "",
  css: "",
  plainText: false,
  blockedRemote: 0,
  attachments: [],
  messageIdHeader: null,
  references: null,
  listUnsubscribe: null,
  ...over,
});

const detail = (labelIds: string[], messages: Message[]): ThreadDetail => ({ id: "t1", subject: "Hello", labelIds, messages, remoteAllowed: false });

describe("summaryFromDetail", () => {
  it("reads flags from the labels", () => {
    const s = summaryFromDetail(detail(["INBOX", "UNREAD", "STARRED", "IMPORTANT", "DRAFT"], [msg("m1", "Ann")]));
    expect(s).toMatchObject({ unread: true, starred: true, important: true, hasDraft: true, labelIds: ["INBOX", "UNREAD", "STARRED", "IMPORTANT", "DRAFT"] });
    const plain = summaryFromDetail(detail(["INBOX"], [msg("m1", "Ann")]));
    expect(plain).toMatchObject({ unread: false, starred: false, important: false, hasDraft: false });
  });

  it("takes sender from the first message and the rest from the last", () => {
    const s = summaryFromDetail(
      detail(["INBOX"], [
        msg("m1", "Ann", { date: 1000 }),
        msg("m2", "Bob", { date: 2000, snippet: "latest", to: [{ name: "Ann", email: "ann@example.com" }] }),
        msg("m3", "Ann", { date: 3000, snippet: "newest", to: [{ name: "Bob", email: "bob@example.com" }] }),
      ]),
    );
    expect(s.subject).toBe("Hello");
    expect(s.from.email).toBe("ann@example.com");
    expect(s.snippet).toBe("newest");
    expect(s.to).toEqual([{ name: "Bob", email: "bob@example.com" }]);
    expect(s.date).toBe(3000);
    expect(s.senders).toEqual(["Ann", "Bob"]);
    expect(s.messageCount).toBe(3);
    expect(s.historyId).toBe("");
  });

  it("notices attachments and keeps an earlier snooze time", () => {
    const att = { id: "a", messageId: "m1", filename: "f.pdf", mimeType: "application/pdf", size: 1, inline: false };
    const d = detail(["INBOX"], [msg("m1", "Ann", { attachments: [att] })]);
    expect(summaryFromDetail(d).hasAttachments).toBe(true);
    expect(summaryFromDetail(d).snoozedUntil).toBeNull();
    const prev = summaryFromDetail(d);
    prev.snoozedUntil = 5000;
    expect(summaryFromDetail(d, prev).snoozedUntil).toBe(5000);
  });

  it("copes with a conversation that has no messages", () => {
    const s = summaryFromDetail(detail([], []));
    expect(s).toMatchObject({ messageCount: 0, snippet: "", senders: [], date: 0 });
    expect(s.from.email).toBe("");
  });
});
