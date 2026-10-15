import { Check } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Kbd } from "./Kbd";
import s from "./ui.module.css";

export type Anchor = { x: number; y: number; w?: number; h?: number };

export function anchorFrom(el: Element): Anchor {
  const r = el.getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}

/** Positioned floating panel that closes on outside click, Escape and resize. */
export function Popover({
  anchor,
  onClose,
  align = "start",
  children,
  width,
  className,
  label,
  escape = true,
}: {
  anchor: Anchor;
  onClose: () => void;
  align?: "start" | "end";
  children: ReactNode;
  width?: number;
  className?: string;
  label?: string;
  /** Set false when the opener handles Escape itself (e.g. a search field). */
  escape?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; origin: string } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { offsetWidth: w, offsetHeight: h } = el;
    const aw = anchor.w ?? 0;
    const ah = anchor.h ?? 0;
    let left = align === "end" ? anchor.x + aw - w : anchor.x;
    let top = anchor.y + ah + 6;
    let originY = "top";
    if (top + h > window.innerHeight - 8) {
      top = Math.max(8, anchor.y - h - 6);
      originY = "bottom";
    }
    left = Math.max(8, Math.min(window.innerWidth - w - 8, left));
    setPos({ left, top, origin: `${originY} ${align === "end" ? "right" : "left"}` });
  }, [anchor, align]);

  useEffect(() => {
    const down = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape" && escape) {
        e.stopPropagation();
        onClose();
      }
    };
    const blur = () => onClose();
    // Defer so the click that opened us doesn't immediately close us.
    const t = setTimeout(() => document.addEventListener("mousedown", down, true), 0);
    window.addEventListener("keydown", key, true);
    window.addEventListener("resize", blur);
    window.addEventListener("blur", blur);
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", down, true);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("resize", blur);
      window.removeEventListener("blur", blur);
    };
  }, [onClose, escape]);

  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={label}
      className={`${s.popover} ${className ?? ""}`}
      style={{
        left: pos?.left ?? -9999,
        top: pos?.top ?? -9999,
        width,
        transformOrigin: pos?.origin,
        visibility: pos ? "visible" : "hidden",
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
    </div>,
    document.body,
  );
}

export type MenuEntry =
  | {
      kind?: "item";
      id: string;
      label: string;
      icon?: ReactNode;
      keys?: string;
      hint?: string;
      danger?: boolean;
      disabled?: boolean;
      checked?: boolean;
      onSelect: () => void;
    }
  | { kind: "sep" }
  | { kind: "header"; label: string };

export function Menu({ anchor, items, onClose, align, width }: { anchor: Anchor; items: MenuEntry[]; onClose: () => void; align?: "start" | "end"; width?: number }) {
  const actionable = items.map((it, i) => ({ it, i })).filter(({ it }) => (it.kind ?? "item") === "item" && !(it as { disabled?: boolean }).disabled);
  const [active, setActive] = useState<number>(-1);
  const listRef = useRef<HTMLDivElement>(null);
  const hasChecks = items.some((it) => (it.kind ?? "item") === "item" && (it as { checked?: boolean }).checked !== undefined);

  useEffect(() => {
    listRef.current?.focus();
  }, []);

  const run = useCallback(
    (idx: number) => {
      const it = items[idx];
      if (!it || (it.kind ?? "item") !== "item") return;
      const item = it as Extract<MenuEntry, { onSelect: () => void }>;
      if (item.disabled) return;
      onClose();
      item.onSelect();
    },
    [items, onClose],
  );

  const onKey = (e: React.KeyboardEvent) => {
    const pos = actionable.findIndex((a) => a.i === active);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive(actionable[(pos + 1) % actionable.length]?.i ?? -1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(actionable[(pos - 1 + actionable.length) % actionable.length]?.i ?? -1);
    } else if (e.key === "Home") setActive(actionable[0]?.i ?? -1);
    else if (e.key === "End") setActive(actionable[actionable.length - 1]?.i ?? -1);
    else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (active >= 0) run(active);
    } else if (e.key.length === 1 && /\S/.test(e.key)) {
      // Type-ahead: jump to the next item starting with that letter.
      const after = [...actionable.slice(pos + 1), ...actionable.slice(0, pos + 1)];
      const hit = after.find((a) => (a.it as { label: string }).label.toLowerCase().startsWith(e.key.toLowerCase()));
      if (hit) setActive(hit.i);
    }
    e.stopPropagation();
  };

  return (
    <Popover anchor={anchor} onClose={onClose} align={align} width={width}>
      <div ref={listRef} role="menu" tabIndex={-1} onKeyDown={onKey} style={{ outline: "none" }}>
        {items.map((it, i) => {
          if (it.kind === "sep") return <div key={i} className={s.menuSep} role="separator" />;
          if (it.kind === "header")
            return (
              <div key={i} className={s.menuHeader}>
                {it.label}
              </div>
            );
          return (
            <button
              key={it.id}
              role={it.checked !== undefined ? "menuitemcheckbox" : "menuitem"}
              aria-checked={it.checked}
              className={s.menuItem}
              data-active={active === i}
              data-danger={it.danger}
              disabled={it.disabled}
              onMouseEnter={() => setActive(i)}
              onMouseLeave={() => setActive(-1)}
              onClick={() => run(i)}
            >
              {hasChecks && <span className={s.check}>{it.checked ? <Check size={14} /> : null}</span>}
              {it.icon}
              <span className={s.menuLabel}>{it.label}</span>
              {it.hint && <span className={s.menuHint}>{it.hint}</span>}
              {it.keys && <Kbd keys={it.keys.split(", ")[0]} />}
            </button>
          );
        })}
      </div>
    </Popover>
  );
}

/** Small helper for components that own one menu at a time. */
export function useMenu() {
  const [menu, setMenu] = useState<{ anchor: Anchor; key: string } | null>(null);
  const close = useCallback(() => setMenu(null), []);
  const openAt = useCallback((anchor: Anchor, key = "menu") => setMenu({ anchor, key }), []);
  return { menu, openAt, close };
}
