import {
  AlarmClock,
  Archive,
  ArchiveRestore,
  Flag,
  Inbox,
  Mail,
  MailOpen,
  Reply,
  ReplyAll,
  Forward,
  ShieldAlert,
  ShieldCheck,
  SquareArrowOutUpRight,
  Star,
  Tag,
  Trash2,
} from "lucide-react";
import type { ThreadSummary, View } from "../../lib/types";
import { openInWindow, startReply, usePicker } from "../../state/actions";
import { useMail } from "../../state/mail";
import type { Anchor, MenuEntry } from "../ui/Menu";

/** Actions for one or more conversations, used by context menus and "More". */
export function threadMenuItems(ids: string[], threads: ThreadSummary[], view: View, anchor: Anchor | null, opts: { replies?: boolean; openWindow?: boolean } = {}): MenuEntry[] {
  const m = useMail.getState();
  const picked = threads.filter((t) => ids.includes(t.id));
  const anyUnread = picked.some((t) => t.unread);
  const anyUnstarred = picked.some((t) => !t.starred);
  const anyNotImportant = picked.some((t) => !t.important);
  const inTrash = view.kind === "label" && view.labelId === "TRASH";
  const inSpam = view.kind === "label" && view.labelId === "SPAM";
  const inInbox = picked.every((t) => t.labelIds.includes("INBOX"));
  const snoozed = picked.some((t) => t.snoozedUntil);
  const single = ids.length === 1;
  const sel = (fn: () => void) => () => {
    // Replies need the conversation selected first.
    if (single && m.selectedId !== ids[0] && m.openId !== ids[0]) m.select(ids[0]);
    fn();
  };

  const items: MenuEntry[] = [];
  // Drafts open in the composer, not a reader window.
  if (opts.openWindow && single && !(view.kind === "label" && view.labelId === "DRAFT")) {
    items.push(
      { id: "openWindow", label: "Open in new window", icon: <SquareArrowOutUpRight size={15} />, keys: "shift+enter", onSelect: () => openInWindow(ids[0]) },
      { kind: "sep" },
    );
  }
  if (opts.replies !== false && single) {
    items.push(
      { id: "reply", label: "Reply", icon: <Reply size={15} />, keys: "r", onSelect: sel(() => startReply("reply")) },
      { id: "replyAll", label: "Reply all", icon: <ReplyAll size={15} />, keys: "a", onSelect: sel(() => startReply("replyAll")) },
      { id: "forward", label: "Forward", icon: <Forward size={15} />, keys: "f", onSelect: sel(() => startReply("forward")) },
      { kind: "sep" },
    );
  }
  if (inTrash) items.push({ id: "restore", label: "Restore", icon: <ArchiveRestore size={15} />, keys: "e", onSelect: () => m.restore(ids) });
  else if (inSpam) items.push({ id: "notspam", label: "Not spam", icon: <ShieldCheck size={15} />, keys: "e", onSelect: () => m.notSpam(ids) });
  else if (inInbox) items.push({ id: "archive", label: "Archive", icon: <Archive size={15} />, keys: "e", onSelect: () => m.archive(ids) });
  else items.push({ id: "inbox", label: "Move to Inbox", icon: <Inbox size={15} />, keys: "e", onSelect: () => m.moveToInbox(ids) });

  items.push(
    anyUnread
      ? { id: "read", label: "Mark as read", icon: <MailOpen size={15} />, keys: "u", onSelect: () => m.setRead(ids, true) }
      : { id: "unread", label: "Mark as unread", icon: <Mail size={15} />, keys: "u", onSelect: () => m.setRead(ids, false) },
    { id: "star", label: anyUnstarred ? "Star" : "Remove star", icon: <Star size={15} />, keys: "s", onSelect: () => m.setStar(ids, anyUnstarred) },
    {
      id: "important",
      label: anyNotImportant ? "Mark important" : "Mark not important",
      icon: <Flag size={15} />,
      keys: "=",
      onSelect: () => m.setImportant(ids, anyNotImportant),
    },
    { kind: "sep" },
    snoozed
      ? { id: "unsnooze", label: "Unsnooze", icon: <AlarmClock size={15} />, onSelect: () => m.snooze(ids, null) }
      : { id: "snooze", label: "Snooze…", icon: <AlarmClock size={15} />, keys: "h", onSelect: () => usePicker.getState().show("snooze", anchor, ids) },
    { id: "label", label: "Labels…", icon: <Tag size={15} />, keys: "l", onSelect: () => usePicker.getState().show("label", anchor, ids) },
    { kind: "sep" },
  );
  if (!inSpam) items.push({ id: "spam", label: "Report spam", icon: <ShieldAlert size={15} />, keys: "!", onSelect: () => m.spam(ids) });
  if (!inTrash) items.push({ id: "trash", label: "Move to Trash", icon: <Trash2 size={15} />, keys: "#", danger: true, onSelect: () => m.trash(ids) });
  return items;
}
