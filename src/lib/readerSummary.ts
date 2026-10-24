import { nameOf } from "./format";
import type { ThreadDetail, ThreadSummary } from "./types";

const NOBODY = { name: null, email: "" };

/**
 * A pop-out window shows one conversation without a list, but the toolbar, label
 * picker and actions all work from a list row. This builds that row from the
 * opened conversation. `prev` carries over what a detail doesn't know (snooze time).
 */
export function summaryFromDetail(d: ThreadDetail, prev?: ThreadSummary | null): ThreadSummary {
  const first = d.messages[0];
  const last = d.messages[d.messages.length - 1];
  const senders: string[] = [];
  for (const m of d.messages) {
    const name = nameOf(m.from);
    if (!senders.includes(name)) senders.push(name);
  }
  return {
    id: d.id,
    historyId: "",
    subject: d.subject,
    snippet: last?.snippet ?? "",
    senders,
    from: first?.from ?? NOBODY,
    to: last?.to ?? [],
    date: last?.date ?? 0,
    unread: d.labelIds.includes("UNREAD"),
    starred: d.labelIds.includes("STARRED"),
    important: d.labelIds.includes("IMPORTANT"),
    hasAttachments: d.messages.some((m) => m.attachments.length > 0),
    hasDraft: d.labelIds.includes("DRAFT"),
    messageCount: d.messages.length,
    labelIds: d.labelIds,
    snoozedUntil: prev?.snoozedUntil ?? null,
  };
}
