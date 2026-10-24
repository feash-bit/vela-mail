// Actions for a pop-out reader window. Reading, starring, labelling and moving the
// email back to the Inbox keep the window open. Archive, Trash, Spam and Snooze
// take the email out of the Inbox, so they finish the job and close the window.

import { getCurrentWindow } from "@tauri-apps/api/window";
import { snoozedMessage } from "../lib/format";
import { api, broadcast, inTauri } from "../lib/ipc";
import type { UndoSpec } from "../lib/types";
import type { Anchor } from "../components/ui/Menu";
import { usePicker } from "./actions";
import { useApp } from "./app";
import { useMail } from "./mail";

/** Closing goes through the window's close handler, which saves drafts and finishes sends first. */
export function closeReaderWindow() {
  if (inTauri()) getCurrentWindow().close().catch(() => {});
}

function target() {
  const accountId = useApp.getState().activeAccount;
  const id = useMail.getState().openId;
  return accountId && id ? { accountId, id } : null;
}

let busy = false;

/** Do the change, tell the main window (so it can refresh and offer Undo), then close. */
async function doneAndClose(message: string, undo: UndoSpec, run: (accountId: string, id: string) => Promise<void>) {
  const t = target();
  if (!t || busy) return;
  busy = true;
  try {
    await run(t.accountId, t.id);
    await broadcast("vela://reader-done", { accountId: t.accountId, threadIds: [t.id], message, undo });
    closeReaderWindow();
  } catch (e) {
    busy = false;
    useApp.getState().error(e, "Couldn't update that conversation.");
  }
}

export const readerArchive = () =>
  doneAndClose("Archived", { kind: "modify", add: ["INBOX"], remove: [] }, (a, id) => api.modifyThreads(a, [id], [], ["INBOX"]));

export const readerTrash = () => doneAndClose("Moved to Trash", { kind: "untrash" }, (a, id) => api.trashThreads(a, [id]));

export const readerSpam = () =>
  doneAndClose("Reported as spam", { kind: "modify", add: ["INBOX"], remove: ["SPAM"] }, (a, id) => api.modifyThreads(a, [id], ["SPAM"], ["INBOX"]));

export function readerSnooze(anchor?: Anchor | null) {
  const t = target();
  if (!t) return;
  usePicker.getState().show("snooze", anchor, [t.id], (until) =>
    doneAndClose(snoozedMessage(until), { kind: "unsnooze" }, (a, id) => api.snoozeThreads(a, [id], until)),
  );
}

/** What the main button does, from the conversation's labels (not from any list view). */
export type PrimaryMove = "restore" | "archive" | "inbox";
export function primaryMove(labelIds: string[]): PrimaryMove {
  if (labelIds.includes("TRASH")) return "restore";
  return labelIds.includes("INBOX") ? "archive" : "inbox";
}

export function runPrimaryMove(labelIds: string[]) {
  const id = target()?.id;
  if (!id) return;
  const m = useMail.getState();
  switch (primaryMove(labelIds)) {
    case "restore":
      return m.restore([id]);
    case "archive":
      return readerArchive();
    case "inbox":
      return m.moveToInbox([id]);
  }
}
