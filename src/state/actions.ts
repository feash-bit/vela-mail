// User-level actions shared by keyboard shortcuts, the command menu, toolbars
// and context menus, so every entry point behaves the same way.

import { forwardSeed, newSeed, replySeed, splitDraftHtml } from "../lib/compose";
import { api, inTauri } from "../lib/ipc";
import type { ShortcutAction } from "../lib/shortcuts";
import { FOLDERS, type FolderId } from "../lib/views";
import { useApp } from "./app";
import { useCompose } from "./compose";
import { targetIds, useMail } from "./mail";
import { create } from "zustand";

export type PickerKind = "snooze" | "label";
interface PickerStore {
  picker: {
    kind: PickerKind;
    ids: string[];
    anchor: { x: number; y: number; w?: number; h?: number } | null;
    /** Replaces the normal snooze action (a pop-out window closes after snoozing). */
    onSnooze?: (until: number) => void;
  } | null;
  show: (kind: PickerKind, anchor?: { x: number; y: number; w?: number; h?: number } | null, ids?: string[], onSnooze?: (until: number) => void) => void;
  hide: () => void;
}

export const usePicker = create<PickerStore>((set) => ({
  picker: null,
  show: (kind, anchor = null, ids, onSnooze) => {
    const t = ids ?? targetIds();
    if (t.length) set({ picker: { kind, ids: t, anchor, onSnooze } });
  },
  hide: () => set({ picker: null }),
}));

export const FOCUS_SEARCH = "vela:focus-search";
export const OPEN_DRAFT = "vela:open-draft";

/** Load a saved Gmail draft and continue it in the composer. */
export async function openDraft(threadId: string) {
  const a = acct();
  if (!a) return;
  // Already open? Bring it forward.
  const existing = useCompose.getState().composers.find((c) => c.seed.threadId === threadId && c.seed.draftId);
  if (existing) return useCompose.getState().setMinimized(existing.key, false);
  try {
    const d = await api.openDraft(a, threadId);
    const { body, quote } = splitDraftHtml(d.html);
    const isReply = !!d.inReplyTo;
    useCompose.getState().open(
      a,
      newSeed({
        mode: "draft",
        draftId: d.draftId,
        threadId: isReply ? d.threadId : null,
        to: d.to,
        cc: d.cc,
        bcc: d.bcc,
        subject: d.subject,
        body,
        quote,
        inReplyTo: d.inReplyTo,
        references: d.references,
        files: d.files,
      }),
    );
  } catch (e) {
    useApp.getState().error(e, "Couldn't open that draft.");
  }
}

const acct = () => useApp.getState().activeAccount;

function currentThread() {
  const m = useMail.getState();
  const id = m.openId ?? m.selectedId;
  return id ? { id, detail: m.details[id], summary: m.threads.find((t) => t.id === id) } : null;
}

function lastMessage() {
  const t = currentThread();
  const msgs = t?.detail?.messages ?? [];
  return msgs.length ? msgs[msgs.length - 1] : null;
}

export async function startReply(kind: "reply" | "replyAll" | "forward", messageId?: string) {
  const a = acct();
  const t = currentThread();
  if (!a || !t) return;
  const layout = useApp.getState().settings?.readerLayout;
  if (layout === "full" && !useMail.getState().openId) useMail.getState().open(t.id);
  if (!t.detail) await useMail.getState().loadDetail(t.id);
  const detail = useMail.getState().details[t.id];
  const msg = (messageId && detail?.messages.find((m) => m.id === messageId)) || detail?.messages[detail.messages.length - 1];
  if (!msg) return;
  const seed = kind === "forward" ? forwardSeed(msg) : replySeed(msg, a, kind === "replyAll");
  useCompose.getState().open(a, seed, "inline");
}

/** Show a conversation in its own window. Drafts open in the composer instead. */
export async function openInWindow(threadId?: string) {
  const a = acct();
  const m = useMail.getState();
  const id = threadId ?? m.openId ?? m.selectedId;
  if (!a || !id || (m.view.kind === "label" && m.view.labelId === "DRAFT")) return;
  if (!inTauri()) return useApp.getState().toast("Pop-out windows need the desktop app.");
  try {
    await api.openReaderWindow(a, id);
  } catch (e) {
    useApp.getState().error(e, "Couldn't open a new window.");
  }
}

export function compose() {
  const a = acct();
  if (a) useCompose.getState().open(a, newSeed());
}

export function goFolder(id: FolderId) {
  const f = FOLDERS.find((x) => x.id === id);
  if (f) useMail.getState().setView(f.view);
}

export function toggleStar() {
  const ids = targetIds();
  const m = useMail.getState();
  const anyUnstarred = ids.some((id) => !m.threads.find((t) => t.id === id)?.starred);
  m.setStar(ids, anyUnstarred);
}

export function toggleRead() {
  const ids = targetIds();
  const m = useMail.getState();
  const anyUnread = ids.some((id) => m.threads.find((t) => t.id === id)?.unread);
  m.setRead(ids, anyUnread);
}

export function toggleImportant() {
  const ids = targetIds();
  const m = useMail.getState();
  const anyNot = ids.some((id) => !m.threads.find((t) => t.id === id)?.important);
  m.setImportant(ids, anyNot);
}

/** Archive, or the opposite move when already archived/spam/trash. */
export function archiveOrRestore() {
  const ids = targetIds();
  const m = useMail.getState();
  const v = m.view;
  if (v.kind === "label" && v.labelId === "TRASH") return m.restore(ids);
  if (v.kind === "label" && v.labelId === "SPAM") return m.notSpam(ids);
  if (v.kind === "archive") return m.moveToInbox(ids);
  return m.archive(ids);
}

export function runAction(action: ShortcutAction) {
  const m = useMail.getState();
  const app = useApp.getState();
  switch (action) {
    case "compose":
      return compose();
    case "search":
      return window.dispatchEvent(new Event(FOCUS_SEARCH));
    case "palette":
      return app.openDialog(app.dialog === "palette" ? null : "palette");
    case "reply":
      return startReply("reply");
    case "replyAll":
      return startReply("replyAll");
    case "forward":
      return startReply("forward");
    case "archive":
      return archiveOrRestore();
    case "trash":
      return m.trash(targetIds());
    case "star":
      return toggleStar();
    case "important":
      return toggleImportant();
    case "toggleRead":
      return toggleRead();
    case "snooze":
      return usePicker.getState().show("snooze");
    case "label":
      return usePicker.getState().show("label");
    case "spam":
      return m.spam(targetIds());
    case "next":
      return m.move(1);
    case "prev":
      return m.move(-1);
    case "open":
      return m.selectedId && m.open(m.selectedId);
    case "openWindow":
      return openInWindow();
    case "back":
      if (m.checked.size) return m.clearChecks();
      if (m.openId) return m.open(null);
      return;
    case "select":
      return m.selectedId && m.toggleCheck(m.selectedId);
    case "selectAll":
      return m.checked.size === m.threads.length ? m.clearChecks() : m.checkAll();
    case "undo":
      return m.runUndo();
    case "refresh":
      api.syncNow().catch(() => {});
      return m.reload();
    case "goInbox":
      return goFolder("inbox");
    case "goStarred":
      return goFolder("starred");
    case "goSnoozed":
      return goFolder("snoozed");
    case "goSent":
      return goFolder("sent");
    case "goDrafts":
      return goFolder("drafts");
    case "goArchive":
      return goFolder("archive");
    case "goSpam":
      return goFolder("spam");
    case "goTrash":
      return goFolder("trash");
    case "toggleSidebar":
      return app.updateSettings({ sidebarCompact: !app.settings?.sidebarCompact });
    case "settings":
      return app.openDialog("settings");
    case "help":
      return app.openDialog(app.dialog === "shortcuts" ? null : "shortcuts");
  }
}

export { lastMessage };
