import { AlarmClock, Briefcase, CalendarDays, Check, Minus, Moon, Sofa, Sunrise } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { usePicker } from "../../state/actions";
import { useApp } from "../../state/app";
import { useMail } from "../../state/mail";
import { Popover, type Anchor } from "../ui/Menu";
import { Button, TextInput } from "../ui/primitives";
import o from "./overlays.module.css";

function at(base: Date, days: number, hour: number) {
  const d = new Date(base);
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d;
}

export function snoozeOptions(now = new Date()): { id: string; label: string; icon: ReactNode; when: Date }[] {
  const opts: { id: string; label: string; icon: ReactNode; when: Date }[] = [];
  const later = new Date(now.getTime() + 3 * 3600_000);
  later.setMinutes(0, 0, 0);
  if (later.getDate() === now.getDate() && later.getHours() < 21) opts.push({ id: "later", label: "Later today", icon: <AlarmClock size={15} />, when: later });
  if (now.getHours() < 17) opts.push({ id: "evening", label: "This evening", icon: <Moon size={15} />, when: at(now, 0, 18) });
  opts.push({ id: "tomorrow", label: "Tomorrow", icon: <Sunrise size={15} />, when: at(now, 1, 8) });
  const day = now.getDay(); // 0 Sun … 6 Sat
  if (day >= 1 && day <= 4) opts.push({ id: "weekend", label: "This weekend", icon: <Sofa size={15} />, when: at(now, 6 - day, 9) });
  const toMonday = ((8 - day) % 7) || 7;
  opts.push({ id: "nextweek", label: "Next week", icon: <Briefcase size={15} />, when: at(now, toMonday, 8) });
  return opts;
}

const fmtWhen = (d: Date) => d.toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });

function centerAnchor(): Anchor {
  return { x: window.innerWidth / 2 - 140, y: window.innerHeight * 0.22 };
}

function SnoozePicker({ ids, anchor, onClose }: { ids: string[]; anchor: Anchor; onClose: () => void }) {
  const options = useMemo(() => snoozeOptions(), []);
  const [active, setActive] = useState(0);
  const [custom, setCustom] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const choose = (when: Date) => {
    onClose();
    useMail.getState().snooze(ids, when.getTime());
  };
  return (
    <Popover anchor={anchor} onClose={onClose} width={290} label="Snooze until" className={o.snooze}>
      <div
        ref={ref}
        tabIndex={-1}
        style={{ outline: "none" }}
        onKeyDown={(e) => {
          if (e.target instanceof HTMLInputElement) return;
          if (e.key === "ArrowDown") setActive((a) => Math.min(options.length - 1, a + 1));
          else if (e.key === "ArrowUp") setActive((a) => Math.max(0, a - 1));
          else if (e.key === "Enter") choose(options[active].when);
          else return;
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        {options.map((opt, i) => (
          <button key={opt.id} className={o.snoozeItem} data-active={i === active} onMouseEnter={() => setActive(i)} onClick={() => choose(opt.when)}>
            {opt.icon}
            <span>{opt.label}</span>
            <span className={o.snoozeWhen}>{fmtWhen(opt.when)}</span>
          </button>
        ))}
        <form
          className={o.custom}
          onSubmit={(e) => {
            e.preventDefault();
            const d = new Date(custom);
            if (!custom || isNaN(d.getTime()) || d.getTime() < Date.now()) {
              useApp.getState().toast("Pick a time in the future.", { kind: "error" });
              return;
            }
            choose(d);
          }}
        >
          <TextInput type="datetime-local" value={custom} onChange={(e) => setCustom(e.target.value)} aria-label="Custom snooze time" />
          <Button size="md" type="submit" icon={<CalendarDays size={14} />} aria-label="Snooze until chosen time" />
        </form>
      </div>
    </Popover>
  );
}

function LabelPicker({ ids, anchor, onClose }: { ids: string[]; anchor: Anchor; onClose: () => void }) {
  const accountId = useApp((a) => a.activeAccount);
  const labels = useApp((a) => (accountId ? a.labels[accountId] : undefined));
  const threads = useMail((m) => m.threads);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const user = (labels ?? []).filter((l) => l.kind === "user" && l.name.toLowerCase().includes(q.toLowerCase()));
  const picked = threads.filter((t) => ids.includes(t.id));
  const stateOf = (id: string) => {
    const n = picked.filter((t) => t.labelIds.includes(id)).length;
    return n === 0 ? "off" : n === picked.length ? "on" : "mixed";
  };
  const toggle = (id: string, name: string) => {
    const on = stateOf(id) !== "on";
    useMail.getState().modify(ids, on ? [id] : [], on ? [] : [id], on ? `Added “${name}”` : `Removed “${name}”`, true);
  };
  return (
    <Popover anchor={anchor} onClose={onClose} width={280} label="Labels">
      <div className={o.labelSearch}>
        <TextInput
          autoFocus
          value={q}
          placeholder="Find a label"
          aria-label="Find a label"
          onChange={(e) => (setQ(e.target.value), setActive(0))}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") setActive((a) => Math.min(user.length - 1, a + 1));
            else if (e.key === "ArrowUp") setActive((a) => Math.max(0, a - 1));
            else if (e.key === "Enter" && user[active]) toggle(user[active].id, user[active].name);
            else return;
            e.preventDefault();
          }}
        />
      </div>
      <div className={o.labelList} role="listbox" aria-multiselectable>
        {user.length === 0 && <div className={o.labelEmpty}>{labels?.some((l) => l.kind === "user") ? "No labels match." : "You don't have any Gmail labels yet. Create them in Gmail and they'll appear here."}</div>}
        {user.map((l, i) => {
          const st = stateOf(l.id);
          return (
            <button key={l.id} className={o.labelRow} data-active={i === active} role="option" aria-selected={st === "on"} onMouseEnter={() => setActive(i)} onClick={() => toggle(l.id, l.name)}>
              <span className={o.tick} data-state={st}>
                {st === "on" ? <Check size={11} strokeWidth={3} /> : st === "mixed" ? <Minus size={11} strokeWidth={3} /> : null}
              </span>
              <span className={o.swatch} style={l.color ? { background: l.color.background } : undefined} />
              <span>{l.name}</span>
            </button>
          );
        })}
      </div>
    </Popover>
  );
}

/** Snooze and label pickers, opened from toolbars or with H and L. */
export function Pickers() {
  const picker = usePicker((p) => p.picker);
  const hide = usePicker((p) => p.hide);
  if (!picker) return null;
  const anchor = picker.anchor ?? centerAnchor();
  return picker.kind === "snooze" ? <SnoozePicker ids={picker.ids} anchor={anchor} onClose={hide} /> : <LabelPicker ids={picker.ids} anchor={anchor} onClose={hide} />;
}
