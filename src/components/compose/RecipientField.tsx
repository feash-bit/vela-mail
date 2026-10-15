import { X } from "lucide-react";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { isValidEmail, nameOf, parseAddressInput } from "../../lib/format";
import { api } from "../../lib/ipc";
import type { Address, Contact } from "../../lib/types";
import { anchorFrom, Popover, type Anchor } from "../ui/Menu";
import { Avatar } from "../ui/primitives";
import s from "./compose.module.css";

export interface RecipientHandle {
  focus: () => void;
  /** Turn any text still in the box into a recipient. */
  commit: () => Address[];
}

export const RecipientField = forwardRef<
  RecipientHandle,
  { accountId: string; value: Address[]; onChange: (v: Address[]) => void; placeholder?: string; autoFocus?: boolean; label: string }
>(function RecipientField({ accountId, value, onChange, placeholder, autoFocus, label }, ref) {
  const [text, setText] = useState("");
  const [focusedChip, setFocusedChip] = useState(-1);
  const [suggestions, setSuggestions] = useState<Contact[]>([]);
  const [active, setActive] = useState(0);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const wrap = useRef<HTMLDivElement>(null);

  const add = (raw: string): Address[] => {
    const parts = raw.split(/[,;\n]+/).map(parseAddressInput).filter((a): a is Address => !!a);
    if (!parts.length) return value;
    const existing = new Set(value.map((a) => a.email.toLowerCase()));
    const next = [...value, ...parts.filter((p) => !existing.has(p.email.toLowerCase()))];
    onChange(next);
    setText("");
    setSuggestions([]);
    return next;
  };

  useImperativeHandle(ref, () => ({
    focus: () => input.current?.focus(),
    commit: () => (text.trim() ? add(text) : value),
  }));

  useEffect(() => {
    const q = text.trim();
    if (q.length < 1) {
      setSuggestions([]);
      return;
    }
    let alive = true;
    const t = setTimeout(() => {
      api
        .suggestContacts(accountId, q)
        .then((r) => {
          if (!alive) return;
          const taken = new Set(value.map((a) => a.email.toLowerCase()));
          setSuggestions(r.filter((c) => !taken.has(c.email.toLowerCase())).slice(0, 6));
          setActive(0);
          if (wrap.current) setAnchor(anchorFrom(wrap.current));
        })
        .catch(() => setSuggestions([]));
    }, 120);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [text, accountId, value]);

  const pick = (c: Contact) => {
    add(c.name ? `${c.name} <${c.email}>` : c.email);
    input.current?.focus();
  };

  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const open = suggestions.length > 0;
    if (open && e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(suggestions.length - 1, a + 1));
    } else if (open && e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(0, a - 1));
    } else if ((e.key === "Enter" || e.key === "Tab") && open && text.trim()) {
      e.preventDefault();
      pick(suggestions[active]);
    } else if ((e.key === "Enter" || e.key === "," || e.key === ";") && text.includes("@")) {
      // Only something that looks like an address becomes a recipient.
      e.preventDefault();
      add(text);
    } else if (e.key === "Backspace" && !text) {
      if (focusedChip >= 0) {
        onChange(value.filter((_, i) => i !== focusedChip));
        setFocusedChip(-1);
      } else if (value.length) setFocusedChip(value.length - 1);
    } else if (e.key === "Escape" && open) {
      e.stopPropagation();
      setSuggestions([]);
    } else setFocusedChip(-1);
  };

  return (
    <div ref={wrap} className={s.recipients} onClick={() => input.current?.focus()}>
      {value.map((a, i) => (
        <span key={a.email + i} className={s.rcpt} data-invalid={!isValidEmail(a.email)} data-focused={focusedChip === i} title={a.name ? `${a.name} <${a.email}>` : a.email}>
          <Avatar name={nameOf(a)} email={a.email} size={20} />
          <span className={s.rcptName}>{a.name ?? a.email}</span>
          <button
            className={s.rcptX}
            aria-label={`Remove ${a.email}`}
            onClick={(e) => {
              e.stopPropagation();
              onChange(value.filter((_, j) => j !== i));
            }}
          >
            <X size={11} />
          </button>
        </span>
      ))}
      <input
        ref={input}
        className={s.rcptInput}
        value={text}
        placeholder={value.length ? "" : placeholder}
        aria-label={label}
        autoFocus={autoFocus}
        spellCheck={false}
        onChange={(e) => {
          const v = e.target.value;
          // Pasting a list of addresses adds them all at once.
          if (/[,;\n]/.test(v) && v.includes("@")) add(v);
          else setText(v);
        }}
        onKeyDown={onKey}
        onBlur={() => {
          setTimeout(() => setSuggestions([]), 120);
          if (text.trim() && text.includes("@")) add(text);
        }}
      />
      {suggestions.length > 0 && anchor && (
        <Popover anchor={anchor} onClose={() => setSuggestions([])} width={320} className={s.suggest} escape={false}>
          <div onMouseDown={(e) => e.preventDefault()}>
            {suggestions.map((c, i) => (
              <button key={c.email} className={s.suggestItem} data-active={i === active} onMouseEnter={() => setActive(i)} onClick={() => pick(c)}>
                <Avatar name={nameOf(c)} email={c.email} size={26} />
                <span className={s.suggestText}>
                  <span className={s.suggestName}>{c.name ?? c.email}</span>
                  {c.name && <span className={s.suggestEmail}>{c.email}</span>}
                </span>
              </button>
            ))}
          </div>
        </Popover>
      )}
    </div>
  );
});
