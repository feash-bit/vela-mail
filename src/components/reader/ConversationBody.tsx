import { Forward, Reply, ReplyAll } from "lucide-react";
import { useEffect, useState } from "react";
import { nameOf } from "../../lib/format";
import type { ThreadDetail, ThreadSummary } from "../../lib/types";
import { HIDDEN_CHIP_LABELS } from "../../lib/views";
import { openDraft, startReply } from "../../state/actions";
import { useApp } from "../../state/app";
import { useCompose } from "../../state/compose";
import { Composer } from "../compose/Composer";
import { Button, IconButton, Kbd } from "../ui/primitives";
import { MessageCard } from "./MessageCard";
import s from "./reader.module.css";

/** The conversation itself: subject, labels, messages and the reply box. Shared by the main reader and pop-out windows. */
export function ConversationBody({
  id,
  detail,
  summary,
  accountId,
}: {
  id: string;
  detail: ThreadDetail;
  summary?: ThreadSummary;
  accountId: string | null;
}) {
  const labels = useApp((a) => (accountId ? a.labels[accountId] : undefined));
  const composers = useCompose((c) => c.composers);
  const inline = composers.find((c) => c.placement === "inline" && c.seed.threadId === id && !c.minimized);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showOlder, setShowOlder] = useState(false);

  // Expand unread messages plus the latest one when a conversation opens.
  useEffect(() => {
    const msgs = detail.messages;
    const next = new Set(msgs.filter((m) => m.unread).map((m) => m.id));
    if (msgs.length) next.add(msgs[msgs.length - 1].id);
    setExpanded(next);
    setShowOlder(false);
  }, [detail.id]);

  const labelById = new Map((labels ?? []).map((l) => [l.id, l]));
  const chips = detail.labelIds.filter((l) => !HIDDEN_CHIP_LABELS.has(l)).map((l) => labelById.get(l)).filter(Boolean);

  const messages = detail.messages;
  // Long threads: collapse the middle into "N older messages".
  const hideMiddle = !showOlder && messages.length > 5;
  const visible = hideMiddle ? [messages[0], ...messages.slice(-3)] : messages;
  const hiddenCount = messages.length - visible.length;
  const last = messages[messages.length - 1];

  return (
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
  );
}
