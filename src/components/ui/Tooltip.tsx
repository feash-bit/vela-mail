import { cloneElement, isValidElement, useEffect, useRef, useState, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { Kbd } from "./Kbd";
import s from "./ui.module.css";

// One tooltip at a time; once one has shown, neighbours appear instantly
// (like macOS) so scanning a toolbar feels quick.
let warmUntil = 0;

export function Tooltip({
  label,
  keys,
  side = "bottom",
  children,
}: {
  label: string;
  keys?: string;
  side?: "top" | "bottom";
  children: ReactElement<Record<string, unknown>>;
}) {
  const [pos, setPos] = useState<{ x: number; y: number; side: "top" | "bottom" } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const anchor = useRef<HTMLElement | null>(null);

  const show = (el: HTMLElement) => {
    anchor.current = el;
    const delay = Date.now() < warmUntil ? 0 : 550;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const r = el.getBoundingClientRect();
      const below = side === "bottom" ? r.bottom + 34 < window.innerHeight : r.top < 40;
      setPos({ x: r.left + r.width / 2, y: below ? r.bottom + 7 : r.top - 7, side: below ? "bottom" : "top" });
    }, delay);
  };
  const hide = () => {
    if (timer.current) clearTimeout(timer.current);
    if (pos) warmUntil = Date.now() + 600;
    setPos(null);
  };

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  if (!isValidElement(children)) return children;
  const props = children.props as Record<string, (e: React.SyntheticEvent<HTMLElement>) => void>;
  const child = cloneElement(children, {
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) => {
      props.onMouseEnter?.(e);
      show(e.currentTarget);
    },
    onMouseLeave: (e: React.MouseEvent<HTMLElement>) => {
      props.onMouseLeave?.(e);
      hide();
    },
    onMouseDown: (e: React.MouseEvent<HTMLElement>) => {
      props.onMouseDown?.(e);
      hide();
    },
    onFocus: (e: React.FocusEvent<HTMLElement>) => {
      props.onFocus?.(e);
      if (e.currentTarget.matches(":focus-visible")) show(e.currentTarget);
    },
    onBlur: (e: React.FocusEvent<HTMLElement>) => {
      props.onBlur?.(e);
      hide();
    },
  });

  return (
    <>
      {child}
      {pos &&
        createPortal(
          <div
            role="tooltip"
            className={s.tooltip}
            ref={(el) => {
              if (!el) return;
              // Keep inside the window horizontally.
              const w = el.offsetWidth;
              const left = Math.max(8, Math.min(window.innerWidth - w - 8, pos.x - w / 2));
              el.style.left = `${left}px`;
              el.style.top = pos.side === "bottom" ? `${pos.y}px` : `${pos.y - el.offsetHeight}px`;
            }}
            style={{ left: pos.x, top: pos.y }}
          >
            {label}
            {keys && <Kbd keys={keys.split(", ")[0]} />}
          </div>,
          document.body,
        )}
    </>
  );
}
