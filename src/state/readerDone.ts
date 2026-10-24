// The main window's side of "a pop-out finished with its email and closed".

import { api } from "../lib/ipc";
import type { ReaderDone, UndoSpec } from "../lib/types";
import { useApp } from "./app";
import { announceChanged, useMail } from "./mail";

/** Reverse what the pop-out did. Always uses the account the action was taken on, not the active one. */
export async function revertReaderAction(accountId: string, threadIds: string[], undo: UndoSpec): Promise<void> {
  switch (undo.kind) {
    case "modify":
      return api.modifyThreads(accountId, threadIds, undo.add, undo.remove);
    case "untrash":
      return api.trashThreads(accountId, threadIds, true);
    case "unsnooze":
      return api.snoozeThreads(accountId, threadIds, null);
  }
}

/** Refresh the lists and offer Undo for something done in a pop-out window. */
export function handleReaderDone(done: ReaderDone) {
  const app = useApp.getState();
  if (!app.accounts.some((a) => a.id === done.accountId)) return;
  useMail.getState().applyChanged({ accountId: done.accountId, threadIds: done.threadIds, labelsChanged: true, fullRefresh: false });
  useMail.setState({
    undo: {
      label: done.message,
      revert: async () => {
        await revertReaderAction(done.accountId, done.threadIds, done.undo);
        announceChanged(done.accountId, done.threadIds);
        useApp.getState().loadLabels(done.accountId);
        useMail.getState().reload({ silent: true });
      },
    },
  });
  app.toast(done.message, { action: { label: "Undo", run: () => useMail.getState().runUndo() } });
}
