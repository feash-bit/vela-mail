import { AlarmClock, Archive, ArchiveRestore, Check, ChevronsRight, Mail, MailOpen, Paperclip, Star, Trash2 } from "lucide-react";
import { memo, type CSSProperties } from "react";
import { listDate, nameOf, sendersLine } from "../../lib/format";
import type { Label, ThreadSummary } from "../../lib/types";
import { HIDDEN_CHIP_LABELS } from "../../lib/views";
import { Avatar, IconButton } from "../ui/primitives";
import s from "./mail.module.css";

export interface RowHandlers {
  onClick: (t: ThreadSummary, e: React.MouseEvent) => void;
  onDoubleClick: (t: ThreadSummary) => void;
  onCheck: (t: ThreadSummary, range: boolean) => void;
  onContext: (t: ThreadSummary, e: React.MouseEvent) => void;
  onArchive: (t: ThreadSummary) => void;
  onTrash: (t: ThreadSummary) => void;
  onStar: (t: ThreadSummary) => void;
  onRead: (t: ThreadSummary) => void;
}

interface Props {
  t: ThreadSummary;
  style: CSSProperties;
  selected: boolean;
  checked: boolean;
  showAvatar: boolean;
  showSnippet: boolean;
  sentView: boolean;
  archived: boolean;
  labels: Map<string, Label>;
  h: RowHandlers;
}

export const MailRow = memo(function MailRow({ t, style, selected, checked, showAvatar, showSnippet, sentView, archived, labels, h }: Props) {
  const who = sentView && t.to.length ? `To: ${t.to.map(nameOf).join(", ")}` : sendersLine(t.senders.length ? t.senders : [nameOf(t.from)], 1);
  const chips = t.labelIds
    .filter((id) => !HIDDEN_CHIP_LABELS.has(id))
    .map((id) => labels.get(id))
    .filter((l): l is Label => !!l)
    .slice(0, 2);
  const date = listDate(t.date);
  return (
    <div
      role="option"
      aria-selected={selected}
      aria-label={`${t.unread ? "Unread. " : ""}${who}. ${t.subject || "No subject"}. ${date}`}
      className={`${s.row} ${t.unread ? s.unread : ""}`}
      data-selected={selected}
      data-checked={checked}
      style={style}
      onClick={(e) => h.onClick(t, e)}
      onDoubleClick={() => h.onDoubleClick(t)}
      onContextMenu={(e) => {
        e.preventDefault();
        h.onContext(t, e);
      }}
    >
      <div className={s.lead}>
        {t.unread && <span className={s.unreadDot} aria-hidden />}
        {showAvatar && (
          <span className={s.avatarSlot}>
            <Avatar name={nameOf(t.from)} email={t.from.email || t.id} size={34} />
          </span>
        )}
        <span className={showAvatar ? s.checkSlot : ""} style={showAvatar ? undefined : { display: "grid" }}>
          <button
            className={s.checkbox}
            role="checkbox"
            aria-checked={checked}
            aria-label="Select conversation"
            onClick={(e) => {
              e.stopPropagation();
              h.onCheck(t, e.shiftKey);
            }}
          >
            <span className={s.box} data-on={checked}>
              {checked && <Check size={12} strokeWidth={3} />}
            </span>
          </button>
        </span>
      </div>

      <div className={s.body}>
        <div className={s.line1}>
          <span className={s.sender}>
            {who}
            {t.messageCount > 1 && <span className={s.count}>{t.messageCount}</span>}
          </span>
          <span className={s.date}>{date}</span>
        </div>
        <div className={s.subject}>{t.subject || "(no subject)"}</div>
        <div className={s.line3}>
          {t.hasDraft && <span className={s.draftTag}>Draft</span>}
          {t.snoozedUntil && (
            <span className={s.snoozeTag}>
              <AlarmClock size={11} /> {listDate(t.snoozedUntil)}
            </span>
          )}
          {showSnippet && <span className={s.snippet}>{t.snippet}</span>}
          {!showSnippet && <span className={s.snippet} />}
          {chips.map((l) => (
            <span key={l.id} className={s.labelChip} style={l.color ? { background: l.color.background, color: l.color.text } : undefined}>
              {l.name.split("/").pop()}
            </span>
          ))}
          <span className={s.icons}>
            {t.important && <ChevronsRight size={13} className={s.importantOn} aria-label="Important" />}
            {t.hasAttachments && <Paperclip size={13} aria-label="Has attachments" />}
            {t.starred && <Star size={13} className={s.starOn} aria-label="Starred" />}
          </span>
          <span className={s.compactDate}>{date}</span>
        </div>
      </div>

      <div className={s.quick} onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
        <IconButton small label={archived ? "Move to Inbox" : "Archive"} keys="e" tooltipSide="top" onClick={() => h.onArchive(t)}>
          {archived ? <ArchiveRestore size={15} /> : <Archive size={15} />}
        </IconButton>
        <IconButton small label="Move to Trash" keys="#" tooltipSide="top" onClick={() => h.onTrash(t)}>
          <Trash2 size={15} />
        </IconButton>
        <IconButton small label={t.unread ? "Mark as read" : "Mark as unread"} keys="u" tooltipSide="top" onClick={() => h.onRead(t)}>
          {t.unread ? <MailOpen size={15} /> : <Mail size={15} />}
        </IconButton>
        <IconButton small label={t.starred ? "Remove star" : "Star"} keys="s" tooltipSide="top" onClick={() => h.onStar(t)}>
          <Star size={15} className={t.starred ? s.starOn : undefined} />
        </IconButton>
      </div>
    </div>
  );
});
