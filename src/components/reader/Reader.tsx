import {
  AlarmClock,
  Archive,
  ArchiveRestore,
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  Ellipsis,
  Forward,
  Inbox,
  Mail,
  MailOpen,
  RefreshCw,
  Reply,
  ReplyAll,
  Star,
  Tag,
  Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { nameOf } from "../../lib/format";
import { HIDDEN_CHIP_LABELS } from "../../lib/views";
import { openDraft, startReply, toggleRead, toggleStar, usePicker } from "../../state/actions";
import { useApp } from "../../state/app";
import { useCompose } from "../../state/compose";
import { sortThreads, useMail } from "../../state/mail";
import { Composer } from "../compose/Composer";
import { threadMenuItems } from "../mail/threadMenu";
import { anchorFrom, Menu, useMenu } from "../ui/Menu";
import { Button, EmptyState, IconButton, Kbd, Skeleton } from "../ui/primitives";
import { LogoMark } from "../shell/LogoMark";
import { MessageCard } from "./MessageCard";
import s from "./reader.module.css";

function Idle() {
  return (
    <div className={s.idle}>
      <div className={s.idleInner}>
        <LogoMark className={s.idleMark} size={64} />
        <h2 className={s.idleTitle}>Pick a conversation</h2>
        <p className={s.idleBody}>Everything here works from the keyboard.</p>
        <div className={s.hints}>
          <Kbd keys="j" /> <span>Next conversation</span>
          <Kbd keys="e" /> <span>Archive</span>
          <Kbd keys="r" /> <span>Reply</span>
          <Kbd keys="c" /> <span>New message</span>
          <Kbd keys="mod+k" /> <span>Command menu</span>
        </div>
      </div>
    </div>
  );
}

function Loading() {
  return (
    <div className={s.loadingHead} aria-busy="true" aria-label="Loading conversation">
      <Skeleton width="62%" height={26} />
      <Skeleton width={120} height={18} />
      <div style={{ display: "flex", gap: 12, marginTop: 14 }}>
        <Skeleton width={36} height={36} style={{ borderRadius: "50%" }} />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 8 }}>
          <Skeleton width="30%" height={12} />
          <Skeleton width="45%" height={10} />
        </div>
      </div>
      <Skeleton width="100%" height={220} style={{ marginTop: 10, borderRadius: 10 }} />
    </div>
  );
}

export function Reader({ full }: { full: boolean }) {
  const accountId = useApp((a) => a.activeAccount);
  const labels = useApp((a) => (accountId ? a.labels[accountId] : undefined));
  const selectedId = useMail((m) => m.selectedId);
  const openId = useMail((m) => m.openId);
  const id = full ? openId : selectedId;
  const detail = useMail((m) => (id ? m.details[id] : undefined));
  const summary = useMail((m) => m.threads.find((t) => t.id === id));
  const loading = useMail((m) => m.detailLoading === id);
  const error = useMail((m) => m.detailError);
  const view = useMail((m) => m.view);
  const threads = useMail((m) => m.threads);
  const sort = useMail((m) => m.sort);
  const composers = useCompose((c) => c.composers);
  const inline = composers.find((c) => c.placement === "inline" && c.seed.threadId === id && !c.minimized);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showOlder, setShowOlder] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const { menu, openAt, close } = useMenu();

  // Expand unread messages plus the latest one when a conversation opens.
  useEffect(() => {
    if (!detail) return;
    const msgs = detail.messages;
    const next = new Set(msgs.filter((m) => m.unread).map((m) => m.id));
    if (msgs.length) next.add(msgs[msgs.length - 1].id);
    setExpanded(next);
    setShowOlder(false);
  }, [detail?.id]);

  const list = useMemo(() => sortThreads(threads, sort), [threads, sort]);
  const index = list.findIndex((t) => t.id === id);

  if (!id) return full ? null : <section className={s.reader}><Idle /></section>;

  const labelById = new Map((labels ?? []).map((l) => [l.id, l]));
  const chips = (detail?.labelIds ?? summary?.labelIds ?? []).filter((l) => !HIDDEN_CHIP_LABELS.has(l)).map((l) => labelById.get(l)).filter(Boolean);
  const inTrash = view.kind === "label" && view.labelId === "TRASH";
  const inInbox = (summary?.labelIds ?? detail?.labelIds ?? []).includes("INBOX");
  const ids = [id];
  const m = useMail.getState();

  const messages = detail?.messages ?? [];
  // Long threads: collapse the middle into "N older messages".
  const hideMiddle = !showOlder && messages.length > 5;
  const visible = hideMiddle ? [messages[0], ...messages.slice(-3)] : messages;
  const hiddenCount = messages.length - visible.length;
  const last = messages[messages.length - 1];

  return (
    <section className={s.reader} aria-label="Conversation">
      <div className={s.toolbar} data-scrolled={scrolled}>
        {full && (
          <>
            <IconButton label="Back to list" keys="escape" onClick={() => m.open(null)}>
              <ArrowLeft size={17} />
            </IconButton>
            <span className={s.toolSep} />
          </>
        )}
        <div className={s.toolGroup}>
          {inTrash ? (
            <IconButton label="Restore" keys="e" onClick={() => m.restore(ids)}>
              <ArchiveRestore size={16} />
            </IconButton>
          ) : inInbox ? (
            <IconButton label="Archive" keys="e" onClick={() => m.archive(ids)}>
              <Archive size={16} />
            </IconButton>
          ) : (
            <IconButton label="Move to Inbox" keys="e" onClick={() => m.moveToInbox(ids)}>
              <Inbox size={16} />
            </IconButton>
          )}
          {!inTrash && (
            <IconButton label="Move to Trash" keys="#" onClick={() => m.trash(ids)}>
              <Trash2 size={16} />
            </IconButton>
          )}
          <IconButton label="Snooze" keys="h" onClick={(e) => usePicker.getState().show("snooze", anchorFrom(e.currentTarget), ids)}>
            <AlarmClock size={16} />
          </IconButton>
          <IconButton label="Labels" keys="l" onClick={(e) => usePicker.getState().show("label", anchorFrom(e.currentTarget), ids)}>
            <Tag size={16} />
          </IconButton>
          <span className={s.toolSep} />
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
        <span className={s.spacer} />
        {index >= 0 && (
          <span className={s.position}>
            {index + 1} of {list.length}
          </span>
        )}
        <IconButton label="Previous conversation" keys="k" disabled={index <= 0} onClick={() => m.move(-1)}>
          <ChevronUp size={17} />
        </IconButton>
        <IconButton label="Next conversation" keys="j" disabled={index < 0 || index >= list.length - 1} onClick={() => m.move(1)}>
          <ChevronDown size={17} />
        </IconButton>
      </div>

      <div className={s.scroll} onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 4)}>
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
          <div className={s.inner} key={detail.id}>
            <h1 className={s.subject} data-selectable>
              {detail.subject || summary?.subject || "(no subject)"}
            </h1>
            <div className={s.meta}>
              {chips.map((l) => (
                <span key={l!.id} className={s.labelPill}>
                  {l!.color && <span className={s.labelSwatch} style={{ background: l!.color.background }} />}
                  {l!.name}
                </span>
              ))}
              {messages.length > 1 && <span className={s.metaNote}>{messages.length} messages</span>}
            </div>

            {summary?.hasDraft && !inline && (
              <div className={s.draftCard}>
                <strong>Draft</strong>
                <span>You have an unsent reply in this conversation.</span>
                <Button size="sm" onClick={() => openDraft(id)}>
                  Continue draft
                </Button>
              </div>
            )}

            {visible.map((msg, i) => (
              <div key={msg.id}>
                {hideMiddle && i === 1 && (
                  <button className={s.older} onClick={() => setShowOlder(true)}>
                    <span>{hiddenCount} older messages</span>
                  </button>
                )}
                <MessageCard
                  m={msg}
                  threadId={detail.id}
                  remoteAllowed={detail.remoteAllowed}
                  expanded={expanded.has(msg.id)}
                  onToggle={() =>
                    setExpanded((cur) => {
                      const next = new Set(cur);
                      if (next.has(msg.id)) next.delete(msg.id);
                      else next.add(msg.id);
                      return next;
                    })
                  }
                />
              </div>
            ))}

            {inline ? (
              <Composer instance={inline} />
            ) : (
              last && (
                <div className={s.replyBar}>
                  <button className={s.replyBtn} onClick={() => startReply("reply")}>
                    <Reply size={16} /> Reply to {nameOf(last.from)}
                    <Kbd keys="r" />
                  </button>
                  <IconButton label="Reply all" keys="a" onClick={() => startReply("replyAll")} style={{ width: 44, height: 44 }}>
                    <ReplyAll size={17} />
                  </IconButton>
                  <IconButton label="Forward" keys="f" onClick={() => startReply("forward")} style={{ width: 44, height: 44 }}>
                    <Forward size={17} />
                  </IconButton>
                </div>
              )
            )}
          </div>
        ) : null}
      </div>
      {menu && <Menu anchor={menu.anchor} align="end" onClose={close} items={threadMenuItems(ids, threads, view, menu.anchor, { replies: true })} />}
    </section>
  );
}
