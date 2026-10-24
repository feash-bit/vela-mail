import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  AlarmClock,
  Archive,
  ArchiveRestore,
  CircleAlert,
  Ellipsis,
  Flag,
  Forward,
  Inbox,
  Mail,
  MailOpen,
  RefreshCw,
  Reply,
  ReplyAll,
  ShieldAlert,
  ShieldCheck,
  Star,
  Tag,
  Trash2,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useReaderShortcuts } from "../../hooks/useReaderShortcuts";
import { useTheme } from "../../hooks/useTheme";
import { api, inTauri, on, toAppErr } from "../../lib/ipc";
import { summaryFromDetail } from "../../lib/readerSummary";
import type { AppErr, ReaderTarget } from "../../lib/types";
import { windowLabel } from "../../lib/window";
import { isSettings, parseThreadChanged } from "../../lib/windowEvents";
import { startReply, toggleRead, toggleStar, usePicker } from "../../state/actions";
import { useApp } from "../../state/app";
import { flushPendingSends, saveAllDrafts } from "../../state/compose";
import { useMail } from "../../state/mail";
import { closeReaderWindow, primaryMove, readerSnooze, readerSpam, readerTrash, runPrimaryMove } from "../../state/readerWindow";
import { ComposeLayer } from "../compose/ComposeLayer";
import { ConversationBody } from "../reader/ConversationBody";
import r from "../reader/reader.module.css";
import { LogoMark } from "../shell/LogoMark";
import { Pickers } from "../shell/Pickers";
import shell from "../shell/shell.module.css";
import { ResizeEdges, WindowControls } from "../shell/WindowControls";
import { anchorFrom, Menu, useMenu } from "../ui/Menu";
import { Button, EmptyState, IconButton, Skeleton, Spinner } from "../ui/primitives";
import { Toasts } from "../ui/Toasts";
import w from "./readerwindow.module.css";

/** How long closing may wait for drafts to save and sends to finish. */
const CLOSE_GRACE_MS = 8000;

/** Load everything this window needs for its one email. Only detail-load errors are left to the UI. */
async function bootReader(): Promise<ReaderTarget> {
  const target = await api.readerTarget();
  const { accountId, threadId: id } = target;
  const app = useApp.getState();
  await app.boot();
  if (!useApp.getState().accounts.some((a) => a.id === accountId)) {
    throw { code: "not_found", message: "That account isn't signed in to Vela." } satisfies AppErr;
  }
  // Set directly: switching accounts through the normal action would save settings.
  useApp.setState({ activeAccount: accountId });
  app.loadLabels(accountId);
  app.loadIdentity(accountId);

  useMail.setState({ standalone: true, threads: [], details: {}, selectedId: id, openId: id, view: { kind: "label", labelId: "INBOX" } });
  await useMail.getState().loadDetail(id);

  let detail = useMail.getState().details[id];
  const settings = useApp.getState().settings;
  if (detail && settings) {
    // Images from senders the user trusts load straight away, as they do in the main window.
    const trusted = detail.messages.some((m) => settings.trustedSenders.includes(m.from.email.toLowerCase()));
    if (trusted && settings.blockRemoteImages && !detail.remoteAllowed) {
      await useMail.getState().loadDetail(id, { allowRemote: true, silent: true });
      detail = useMail.getState().details[id] ?? detail;
    }
    seedSummary(id);
    if (detail.labelIds.includes("UNREAD") && settings.markReadOnOpen) useMail.getState().setRead([id], true);
  }
  return target;
}

/** The toolbar and actions work from a list row, so keep one in step with the opened conversation. */
function seedSummary(id: string) {
  const detail = useMail.getState().details[id];
  if (detail) useMail.setState((s) => ({ threads: [summaryFromDetail(detail, s.threads.find((t) => t.id === id))] }));
}

/**
 * Closing never loses a reply: save open drafts and send anything waiting out its undo
 * delay first. Gives up after a few seconds so the window can always be closed.
 */
function useSafeClose(setSaving: (v: boolean) => void) {
  const closing = useRef(false);
  useEffect(() => {
    if (!inTauri()) return;
    const win = getCurrentWindow();
    const un = win.onCloseRequested(async (e) => {
      e.preventDefault();
      if (closing.current) return;
      closing.current = true;
      setSaving(true);
      const flush = (async () => {
        try {
          await saveAllDrafts();
        } catch {
          /* best effort */
        }
        try {
          await flushPendingSends();
        } catch {
          /* best effort */
        }
      })();
      await Promise.race([flush, new Promise((resolve) => setTimeout(resolve, CLOSE_GRACE_MS))]);
      await win.destroy();
    });
    return () => {
      un.then((f) => f());
    };
  }, [setSaving]);
}

function Loading() {
  return (
    <div className={r.loadingHead} aria-busy="true" aria-label="Loading conversation">
      <Skeleton width="62%" height={26} />
      <Skeleton width={120} height={18} />
      <Skeleton width="100%" height={220} style={{ marginTop: 14, borderRadius: 10 }} />
    </div>
  );
}

function ReaderView({ target }: { target: ReaderTarget }) {
  const { accountId, threadId: id } = target;
  const customTitleBar = useApp((a) => a.settings?.customTitleBar ?? true);
  const detail = useMail((m) => m.details[id]);
  const summary = useMail((m) => m.threads.find((t) => t.id === id));
  const loading = useMail((m) => m.detailLoading === id);
  const error = useMail((m) => m.detailError);
  const [scrolled, setScrolled] = useState(false);
  const { menu, openAt, close } = useMenu();
  useReaderShortcuts();

  const labelIds = summary?.labelIds ?? detail?.labelIds ?? [];
  const move = primaryMove(labelIds);
  const inTrash = labelIds.includes("TRASH");
  const inSpam = labelIds.includes("SPAM");
  const subject = detail?.subject || summary?.subject || "(no subject)";

  // Keep the list row in step whenever a fresher copy of the conversation arrives
  // (the first copy was seeded during boot, before any optimistic change).
  const seeded = useRef(detail);
  useEffect(() => {
    if (seeded.current === detail) return;
    seeded.current = detail;
    seedSummary(id);
  }, [detail, id]);

  useEffect(() => {
    if (inTauri()) getCurrentWindow().setTitle(`${subject} — Vela`).catch(() => {});
  }, [subject]);

  useEffect(() => {
    const reload = () => useMail.getState().loadDetail(id, { silent: true });
    const subs = [
      on("settings://changed", (s) => {
        if (isSettings(s)) useApp.getState().receiveSettings(s);
      }),
      on("accounts://changed", (list) => {
        if (Array.isArray(list) && !list.some((a) => a && a.id === accountId)) closeReaderWindow();
      }),
      on("mail://changed", (e) => {
        if (!e || e.accountId !== accountId || !Array.isArray(e.threadIds)) return;
        if (e.labelsChanged) useApp.getState().loadLabels(accountId);
        if (e.fullRefresh || e.threadIds.includes(id)) reload();
      }),
      // The main window (or another pop-out) changed this email.
      on("vela://thread-changed", (p) => {
        const e = parseThreadChanged(p);
        if (e && e.source !== windowLabel() && e.accountId === accountId && e.threadIds.includes(id)) reload();
      }),
    ];
    const online = () => useApp.getState().setOnline(true);
    const offline = () => useApp.getState().setOnline(false);
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    return () => {
      subs.forEach((p) => p.then((un) => un()));
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
    };
  }, [accountId, id]);

  const m = useMail.getState();
  return (
    <div className={w.root} data-chrome={customTitleBar ? "custom" : "native"}>
      {customTitleBar && (
        <header className={w.titlebar} data-tauri-drag-region>
          <span className={w.titleText} data-tauri-drag-region>
            {subject}
          </span>
          <WindowControls />
        </header>
      )}
      <main className={w.panel}>
        <div className={r.toolbar} data-scrolled={scrolled}>
          <div className={r.toolGroup}>
            {move === "restore" ? (
              <IconButton label="Restore" keys="e" onClick={() => runPrimaryMove(labelIds)}>
                <ArchiveRestore size={16} />
              </IconButton>
            ) : move === "archive" ? (
              <IconButton label="Archive" keys="e" onClick={() => runPrimaryMove(labelIds)}>
                <Archive size={16} />
              </IconButton>
            ) : (
              <IconButton label="Move to Inbox" keys="e" onClick={() => runPrimaryMove(labelIds)}>
                <Inbox size={16} />
              </IconButton>
            )}
            {!inTrash && (
              <IconButton label="Move to Trash" keys="#" onClick={readerTrash}>
                <Trash2 size={16} />
              </IconButton>
            )}
            <IconButton label="Snooze" keys="h" onClick={(e) => readerSnooze(anchorFrom(e.currentTarget))}>
              <AlarmClock size={16} />
            </IconButton>
            <IconButton label="Labels" keys="l" onClick={(e) => usePicker.getState().show("label", anchorFrom(e.currentTarget), [id])}>
              <Tag size={16} />
            </IconButton>
            <span className={r.toolSep} />
            <IconButton label={summary?.unread ? "Mark as read" : "Mark as unread"} keys="u" onClick={toggleRead}>
              {summary?.unread ? <MailOpen size={16} /> : <Mail size={16} />}
            </IconButton>
            <IconButton label={summary?.starred ? "Remove star" : "Star"} keys="s" active={summary?.starred} onClick={toggleStar}>
              <Star size={16} style={summary?.starred ? { fill: "var(--star)", color: "var(--star)" } : undefined} />
            </IconButton>
            <IconButton label="More" onClick={(e) => openAt(anchorFrom(e.currentTarget))}>
              <Ellipsis size={16} />
            </IconButton>
          </div>
        </div>

        <div className={r.scroll} onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 4)}>
          {loading && !detail ? (
            <Loading />
          ) : !detail && error ? (
            <EmptyState
              icon={<CircleAlert size={30} />}
              title="Couldn't open this conversation"
              body={error.message}
              action={
                <Button icon={<RefreshCw size={14} />} onClick={() => m.loadDetail(id)}>
                  Try again
                </Button>
              }
            />
          ) : detail ? (
            <ConversationBody id={id} detail={detail} summary={summary} accountId={accountId} />
          ) : null}
        </div>
        {menu && (
          <Menu
            anchor={menu.anchor}
            align="end"
            onClose={close}
            items={[
              { id: "reply", label: "Reply", icon: <Reply size={15} />, keys: "r", onSelect: () => startReply("reply") },
              { id: "replyAll", label: "Reply all", icon: <ReplyAll size={15} />, keys: "a", onSelect: () => startReply("replyAll") },
              { id: "forward", label: "Forward", icon: <Forward size={15} />, keys: "f", onSelect: () => startReply("forward") },
              { kind: "sep" },
              {
                id: "important",
                label: summary?.important ? "Mark not important" : "Mark important",
                icon: <Flag size={15} />,
                keys: "=",
                onSelect: () => m.setImportant([id], !summary?.important),
              },
              inSpam
                ? { id: "notspam", label: "Not spam", icon: <ShieldCheck size={15} />, onSelect: () => m.notSpam([id]) }
                : { id: "spam", label: "Report spam", icon: <ShieldAlert size={15} />, keys: "!", onSelect: readerSpam },
            ]}
          />
        )}
      </main>
      <ComposeLayer />
      <Pickers />
      <Toasts />
      {customTitleBar && <ResizeEdges />}
    </div>
  );
}

/** Root of a pop-out window: one email, nothing else. */
export function ReaderWindowApp() {
  const settings = useApp((a) => a.settings);
  const [target, setTarget] = useState<ReaderTarget | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [finished, setFinished] = useState(false);
  const [saving, setSaving] = useState(false);
  const started = useRef(false);
  useTheme(settings);
  useSafeClose(setSaving);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    bootReader()
      .then(setTarget, (e) => setFailed(toAppErr(e).message))
      .finally(() => setFinished(true));
  }, []);

  // Show the window only once the first real frame (the email or an error) is on screen.
  useEffect(() => {
    if (finished) requestAnimationFrame(() => api.readerReady().catch(() => {}));
  }, [finished]);

  let content;
  if (failed || (finished && !target))
    content = (
      <div className={shell.splash}>
        <EmptyState
          icon={<CircleAlert size={30} />}
          title="This email couldn't be opened"
          body={failed ?? undefined}
          action={<Button onClick={closeReaderWindow}>Close</Button>}
        />
      </div>
    );
  else if (!target || !settings)
    content = (
      <div className={shell.splash}>
        <LogoMark className={shell.splashMark} size={56} />
      </div>
    );
  else content = <ReaderView target={target} />;

  return (
    <>
      {content}
      {saving && (
        <div className={w.saving} role="status">
          <Spinner size={16} /> Saving…
        </div>
      )}
    </>
  );
}
