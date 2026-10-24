import { ChevronDown, Ellipsis, Forward, ImageOff, Reply, ReplyAll } from "lucide-react";
import { useState } from "react";
import { formatAddress, fullDate, listDate, nameOf } from "../../lib/format";
import { api } from "../../lib/ipc";
import type { Message } from "../../lib/types";
import { startReply } from "../../state/actions";
import { useApp } from "../../state/app";
import { useMail } from "../../state/mail";
import { anchorFrom, Menu, Popover, useMenu } from "../ui/Menu";
import { Avatar, Button, IconButton } from "../ui/primitives";
import { Attachments } from "./Attachments";
import { HtmlFrame } from "./HtmlFrame";
import s from "./reader.module.css";

function recipientsLine(m: Message, me: string | null): string {
  const names = [...m.to, ...m.cc].map((a) => (me && a.email.toLowerCase() === me.toLowerCase() ? "me" : nameOf(a)));
  if (!names.length) return "to undisclosed recipients";
  return `to ${names.slice(0, 3).join(", ")}${names.length > 3 ? ` and ${names.length - 3} more` : ""}`;
}

export function MessageCard({
  m,
  expanded,
  onToggle,
  remoteAllowed,
  threadId,
}: {
  m: Message;
  expanded: boolean;
  onToggle: () => void;
  remoteAllowed: boolean;
  threadId: string;
}) {
  const me = useApp((a) => a.activeAccount);
  const { menu, openAt, close } = useMenu();
  const [details, setDetails] = useState<ReturnType<typeof anchorFrom> | null>(null);
  const fromName = nameOf(m.from);

  if (!expanded) {
    return (
      <article className={s.message}>
        <button className={`${s.msgHead} ${s.collapsedHead}`} style={{ width: "100%", textAlign: "left" }} onClick={onToggle} aria-expanded={false}>
          <Avatar name={fromName} email={m.from.email} size={32} />
          <span className={s.name}>{fromName}</span>
          {m.unread && <span className={s.unreadMark} />}
          <span className={s.collapsedSnippet}>{m.snippet}</span>
          <span className={s.msgDate}>{listDate(m.date)}</span>
        </button>
      </article>
    );
  }

  const loadImages = () => useMail.getState().loadDetail(threadId, { allowRemote: true });
  // The backend changes only this one setting, so this works from any window and
  // never overwrites settings changed elsewhere.
  const trustSender = async () => {
    try {
      const saved = await api.trustSender(m.from.email);
      useApp.setState((a) => (a.settings ? { settings: { ...a.settings, trustedSenders: saved.trustedSenders } } : {}));
    } catch (e) {
      useApp.getState().error(e, "Couldn't save that setting.");
      return;
    }
    loadImages();
  };

  const unsubscribe = m.listUnsubscribe?.match(/<(https:[^>]+)>/)?.[1];

  return (
    <article className={s.message} data-expanded="true" aria-label={`Message from ${fromName}`}>
      <header className={s.msgHead}>
        <Avatar name={fromName} email={m.from.email} size={36} />
        <div className={s.who} onClick={onToggle} style={{ cursor: "default" }}>
          <div className={s.whoLine}>
            <span className={s.name} data-selectable>
              {fromName}
            </span>
            <span className={s.email} data-selectable>
              {m.from.email}
            </span>
          </div>
          <button
            className={s.recipients}
            onClick={(e) => {
              e.stopPropagation();
              setDetails(anchorFrom(e.currentTarget));
            }}
            aria-label="Show message details"
          >
            {recipientsLine(m, me)} <ChevronDown size={12} />
          </button>
        </div>
        <time className={s.msgDate} dateTime={new Date(m.date).toISOString()} title={fullDate(m.date)}>
          {listDate(m.date) === new Date(m.date).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) ? listDate(m.date) : fullDate(m.date)}
        </time>
        <div className={s.msgActions}>
          <IconButton small label="Reply" keys="r" onClick={() => startReply("reply", m.id)}>
            <Reply size={15} />
          </IconButton>
          <IconButton small label="More" onClick={(e) => openAt(anchorFrom(e.currentTarget))}>
            <Ellipsis size={15} />
          </IconButton>
        </div>
      </header>

      {m.blockedRemote > 0 && !remoteAllowed && (
        <div className={s.remote} role="note">
          <ImageOff size={15} />
          <span>Remote images are hidden to stop senders tracking when you read this.</span>
          <Button size="sm" variant="ghost" onClick={loadImages}>
            Show images
          </Button>
          <Button size="sm" variant="ghost" onClick={trustSender}>
            Always show from sender
          </Button>
        </div>
      )}

      <div className={s.body}>
        <HtmlFrame html={m.html} css={m.css} plain={m.plainText} allowRemote={remoteAllowed} />
      </div>
      <Attachments items={m.attachments} />

      {details && (
        <Popover anchor={details} onClose={() => setDetails(null)} width={380} label="Message details">
          <dl className={s.details}>
            <dt>From</dt>
            <dd>{formatAddress(m.from)}</dd>
            {m.replyTo.length > 0 && (
              <>
                <dt>Reply to</dt>
                <dd>{m.replyTo.map(formatAddress).join(", ")}</dd>
              </>
            )}
            <dt>To</dt>
            <dd>{m.to.map(formatAddress).join(", ") || "—"}</dd>
            {m.cc.length > 0 && (
              <>
                <dt>Cc</dt>
                <dd>{m.cc.map(formatAddress).join(", ")}</dd>
              </>
            )}
            {m.bcc.length > 0 && (
              <>
                <dt>Bcc</dt>
                <dd>{m.bcc.map(formatAddress).join(", ")}</dd>
              </>
            )}
            <dt>Date</dt>
            <dd>{fullDate(m.date)}</dd>
            <dt>Subject</dt>
            <dd>{m.subject || "(no subject)"}</dd>
          </dl>
        </Popover>
      )}
      {menu && (
        <Menu
          anchor={menu.anchor}
          align="end"
          onClose={close}
          items={[
            { id: "reply", label: "Reply", icon: <Reply size={15} />, keys: "r", onSelect: () => startReply("reply", m.id) },
            { id: "replyAll", label: "Reply all", icon: <ReplyAll size={15} />, keys: "a", onSelect: () => startReply("replyAll", m.id) },
            { id: "forward", label: "Forward", icon: <Forward size={15} />, keys: "f", onSelect: () => startReply("forward", m.id) },
            ...(unsubscribe
              ? [
                  { kind: "sep" as const },
                  { id: "unsub", label: "Unsubscribe…", onSelect: () => api.openExternal(unsubscribe).catch((e) => useApp.getState().error(e)) },
                ]
              : []),
          ]}
        />
      )}
    </article>
  );
}
