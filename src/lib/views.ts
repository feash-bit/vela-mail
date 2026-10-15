import type { View } from "./types";

export type FolderId = "inbox" | "starred" | "snoozed" | "sent" | "drafts" | "archive" | "spam" | "trash";

export interface FolderDef {
  id: FolderId;
  name: string;
  view: View;
  /** Gmail label used for the unread count, if any. */
  countLabel?: string;
  /** Show total rather than unread (Drafts). */
  countTotal?: boolean;
}

export const FOLDERS: FolderDef[] = [
  { id: "inbox", name: "Inbox", view: { kind: "label", labelId: "INBOX" }, countLabel: "INBOX" },
  { id: "starred", name: "Starred", view: { kind: "label", labelId: "STARRED" } },
  { id: "snoozed", name: "Snoozed", view: { kind: "snoozed" } },
  { id: "sent", name: "Sent", view: { kind: "label", labelId: "SENT" } },
  { id: "drafts", name: "Drafts", view: { kind: "label", labelId: "DRAFT" }, countLabel: "DRAFT", countTotal: true },
  { id: "archive", name: "Archive", view: { kind: "archive" } },
  { id: "spam", name: "Spam", view: { kind: "label", labelId: "SPAM" }, countLabel: "SPAM" },
  { id: "trash", name: "Trash", view: { kind: "label", labelId: "TRASH" } },
];

/** Stable string key for a view (used for caching and "last view"). */
export function viewKey(v: View): string {
  switch (v.kind) {
    case "label":
      return `label:${v.labelId}`;
    case "search":
      return `search:${v.query}`;
    default:
      return v.kind;
  }
}

export function viewFromKey(key: string | null | undefined): View | null {
  if (!key) return null;
  if (key.startsWith("label:")) return { kind: "label", labelId: key.slice(6) };
  if (key === "archive") return { kind: "archive" };
  if (key === "snoozed") return { kind: "snoozed" };
  return null;
}

export function folderForView(v: View): FolderDef | undefined {
  const k = viewKey(v);
  return FOLDERS.find((f) => viewKey(f.view) === k);
}

export function viewTitle(v: View, labelName?: (id: string) => string | undefined): string {
  const f = folderForView(v);
  if (f) return f.name;
  if (v.kind === "search") return `Results for “${v.query}”`;
  if (v.kind === "label") return labelName?.(v.labelId) ?? "Label";
  return "Mail";
}

/** Gmail system labels the user shouldn't see as chips. */
export const HIDDEN_CHIP_LABELS = new Set([
  "INBOX",
  "UNREAD",
  "STARRED",
  "IMPORTANT",
  "SENT",
  "DRAFT",
  "SPAM",
  "TRASH",
  "CHAT",
  "CATEGORY_PERSONAL",
  "CATEGORY_SOCIAL",
  "CATEGORY_PROMOTIONS",
  "CATEGORY_UPDATES",
  "CATEGORY_FORUMS",
]);
