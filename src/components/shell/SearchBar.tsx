import { Clock, Search, User, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { api } from "../../lib/ipc";
import type { Contact, View } from "../../lib/types";
import { FOCUS_SEARCH } from "../../state/actions";
import { useApp } from "../../state/app";
import { useMail } from "../../state/mail";
import { Kbd } from "../ui/Kbd";
import { anchorFrom, Popover, type Anchor } from "../ui/Menu";
import s from "./shell.module.css";

const OPERATORS = ["from:", "to:", "subject:", "has:attachment", "is:unread", "is:starred", "after:2026/01/01", "larger:5M", "filename:pdf"];
const DEBOUNCE_MS = 380;

export function SearchBar() {
  const view = useMail((m) => m.view);
  const accountId = useApp((a) => a.activeAccount);
  const recent = useApp((a) => a.settings?.recentSearches ?? []);
  const [q, setQ] = useState(view.kind === "search" ? view.query : "");
  const [focused, setFocused] = useState(false);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [active, setActive] = useState(-1);
  const input = useRef<HTMLInputElement>(null);
  const field = useRef<HTMLDivElement>(null);
  const before = useRef<View | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const focus = () => input.current?.focus();
    window.addEventListener(FOCUS_SEARCH, focus);
    return () => window.removeEventListener(FOCUS_SEARCH, focus);
  }, []);

  // Keep the box in step when the view changes elsewhere (sidebar click).
  useEffect(() => {
    if (view.kind !== "search") {
      setQ("");
      before.current = null;
    }
  }, [view]);

  const run = (query: string, remember: boolean) => {
    const text = query.trim();
    if (timer.current) clearTimeout(timer.current);
    if (!text) return;
    const m = useMail.getState();
    if (m.view.kind !== "search") before.current = m.view;
    m.setView({ kind: "search", query: text });
    if (remember) {
      const app = useApp.getState();
      const list = [text, ...(app.settings?.recentSearches ?? []).filter((r) => r !== text)].slice(0, 8);
      app.updateSettings({ recentSearches: list });
    }
  };

  const clear = () => {
    setQ("");
    if (useMail.getState().view.kind === "search") useMail.getState().setView(before.current ?? { kind: "label", labelId: "INBOX" });
  };

  const onChange = (v: string) => {
    setQ(v);
    setActive(-1);
    if (timer.current) clearTimeout(timer.current);
    if (v.trim().length >= 2) timer.current = setTimeout(() => run(v, false), DEBOUNCE_MS);
    const word = v.split(/\s+/).pop() ?? "";
    const term = word.replace(/^(from|to):/, "");
    if (accountId && term.length >= 1) {
      api
        .suggestContacts(accountId, term)
        .then(setContacts)
        .catch(() => setContacts([]));
    } else setContacts([]);
  };

  const suggestions: { label: string; meta?: string; icon: "recent" | "person" | "search"; apply: () => void }[] = [];
  if (q.trim()) {
    suggestions.push({ label: q.trim(), meta: "Search all mail", icon: "search", apply: () => run(q, true) });
    for (const c of contacts.slice(0, 5)) {
      const words = q.split(/\s+/);
      const last = words.pop() ?? "";
      const op = last.startsWith("to:") ? "to:" : "from:";
      const next = [...words, `${op}${c.email}`].join(" ").trim();
      suggestions.push({ label: c.name ?? c.email, meta: c.email, icon: "person", apply: () => (setQ(next + " "), run(next, true)) });
    }
  } else {
    for (const r of recent.slice(0, 6)) suggestions.push({ label: r, icon: "recent", apply: () => (setQ(r), run(r, true)) });
  }

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(suggestions.length - 1, a + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(-1, a - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (active >= 0 && suggestions[active]) suggestions[active].apply();
      else run(q, true);
      setAnchor(null);
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (anchor) setAnchor(null);
      else {
        if (!q) clear();
        input.current?.blur();
      }
    }
  };

  const insertOperator = (op: string) => {
    const next = `${q.trim() ? q.trim() + " " : ""}${op}`;
    setQ(op.endsWith(":") ? next : next + " ");
    input.current?.focus();
  };

  return (
    <div className={s.search} data-no-drag>
      <div ref={field} className={s.searchField} data-focused={focused} onMouseDown={(e) => e.target === e.currentTarget && e.preventDefault()}>
        <Search size={15} />
        <input
          ref={input}
          className={s.searchInput}
          value={q}
          placeholder="Search mail"
          aria-label="Search mail"
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKey}
          onFocus={() => {
            setFocused(true);
            if (field.current) setAnchor(anchorFrom(field.current));
          }}
          onBlur={() => setFocused(false)}
        />
        {q ? (
          <button className={s.winBtn} style={{ width: 22, height: 22 }} aria-label="Clear search" onMouseDown={(e) => e.preventDefault()} onClick={clear}>
            <X size={13} />
          </button>
        ) : (
          !focused && <Kbd keys="/" />
        )}
      </div>
      {anchor && focused && (
        <Popover
          anchor={anchor}
          onClose={() => {
            // Clicking back into the field shouldn't close the suggestions.
            if (!field.current?.contains(document.activeElement)) setAnchor(null);
          }}
          width={anchor.w}
          className={s.suggest}
          escape={false}
        >
          <div onMouseDown={(e) => e.preventDefault()}>
            {suggestions.length > 0 && <div className={s.suggestHead}>{q.trim() ? "Suggestions" : "Recent searches"}</div>}
            {suggestions.map((sg, i) => (
              <button key={i} className={s.suggestItem} data-active={active === i} onMouseEnter={() => setActive(i)} onClick={() => (sg.apply(), setAnchor(null))}>
                {sg.icon === "recent" ? <Clock size={14} /> : sg.icon === "person" ? <User size={14} /> : <Search size={14} />}
                <span>{sg.label}</span>
                {sg.meta && <span className={s.suggestMeta}>{sg.meta}</span>}
              </button>
            ))}
            <div className={s.suggestHead}>Narrow your search</div>
            <div className={s.operators}>
              {OPERATORS.map((op) => (
                <button key={op} className={s.operator} onClick={() => insertOperator(op)}>
                  {op}
                </button>
              ))}
            </div>
          </div>
        </Popover>
      )}
    </div>
  );
}
