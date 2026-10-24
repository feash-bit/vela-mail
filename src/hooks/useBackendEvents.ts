import { useEffect } from "react";
import { mailtoSeed, newSeed } from "../lib/compose";
import { api, on } from "../lib/ipc";
import type { LocalFile } from "../lib/types";
import { isSettings, parseReaderDone, parseThreadChanged } from "../lib/windowEvents";
import { windowLabel } from "../lib/window";
import { useApp } from "../state/app";
import { useCompose } from "../state/compose";
import { useMail } from "../state/mail";
import { handleReaderDone } from "../state/readerDone";

/** Files dropped on the window go to the focused composer, or start a new one. */
export const FILES_EVENT = "vela:files";

function routeFiles(files: LocalFile[]) {
  const sheets = useCompose.getState().composers.filter((c) => !c.minimized);
  if (sheets.length) {
    window.dispatchEvent(new CustomEvent(FILES_EVENT, { detail: { key: sheets[sheets.length - 1].key, files } }));
    return;
  }
  const acct = useApp.getState().activeAccount;
  if (!acct) return;
  const key = useCompose.getState().open(acct, newSeed());
  // Give the new composer a moment to mount before handing it the files.
  setTimeout(() => window.dispatchEvent(new CustomEvent(FILES_EVENT, { detail: { key, files } })), 60);
}

export function useBackendEvents() {
  useEffect(() => {
    const subs = [
      on("mail://changed", (e) => useMail.getState().applyChanged(e)),
      on("sync://state", (s) => useApp.getState().setSync(s)),
      on("account://status", ({ accountId, status }) => useApp.getState().setAccountStatus(accountId, status)),
      on("accounts://changed", (a) => useApp.getState().setAccounts(a)),
      on("app://open-thread", ({ accountId, threadId }) => {
        const app = useApp.getState();
        if (app.activeAccount !== accountId) app.setActiveAccount(accountId);
        useMail.getState().setView({ kind: "label", labelId: "INBOX" });
        setTimeout(() => useMail.getState().open(threadId), 50);
      }),
      on("app://mailto", (url) => {
        const acct = useApp.getState().activeAccount;
        if (acct) useCompose.getState().open(acct, mailtoSeed(url));
      }),
      on("settings://changed", (s) => {
        if (isSettings(s)) useApp.getState().receiveSettings(s);
      }),
      // A pop-out window changed some conversations.
      on("vela://thread-changed", (p) => {
        const e = parseThreadChanged(p);
        if (e && e.source !== windowLabel()) useMail.getState().applyChanged({ accountId: e.accountId, threadIds: e.threadIds, labelsChanged: true, fullRefresh: false });
      }),
      // A pop-out window finished with its email and closed.
      on("vela://reader-done", (p) => {
        const done = parseReaderDone(p);
        if (done) handleReaderDone(done);
      }),
      on("files://hover", (v) => useApp.getState().setDropHover(v)),
      on("files://dropped", ({ files, errors }) => {
        errors.forEach((m) => useApp.getState().toast(m, { kind: "error" }));
        if (files.length) routeFiles(files);
      }),
    ];

    // A mailto: link that launched Vela.
    api
      .takePendingMailto()
      .then((url) => {
        const acct = useApp.getState().activeAccount;
        if (url && acct) useCompose.getState().open(acct, mailtoSeed(url));
      })
      .catch(() => {});

    const online = () => {
      useApp.getState().setOnline(true);
      api.syncNow().catch(() => {});
      useMail.getState().reload({ silent: true });
    };
    const offline = () => useApp.getState().setOnline(false);
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);

    return () => {
      subs.forEach((p) => p.then((un) => un()));
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
    };
  }, []);
}
