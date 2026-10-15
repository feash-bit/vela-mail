import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Button } from "./primitives";
import s from "./ui.module.css";

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

/** Modal dialog with a focus trap. Escape and clicking the backdrop close it. */
export function Dialog({
  onClose,
  label,
  children,
  className,
  style,
  initialFocus,
}: {
  onClose: () => void;
  label: string;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  initialFocus?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Captured during the first render, before any child autoFocus runs.
  const previous = useRef<Element | null>(document.activeElement);

  useEffect(() => {
    const el = ref.current;
    // Respect an element that already took focus (autoFocus); otherwise focus
    // the requested element, or the dialog itself so no ring flashes on open.
    if (el && !el.contains(document.activeElement)) {
      const target = (initialFocus && el.querySelector<HTMLElement>(initialFocus)) || el;
      target.focus();
    }
    return () => (previous.current as HTMLElement | null)?.focus?.();
  }, [initialFocus]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab" || !ref.current) return;
    const items = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div className={s.scrim} onMouseDown={(e) => e.target === e.currentTarget && onClose()} onKeyDown={onKey}>
      <div ref={ref} role="dialog" aria-modal="true" aria-label={label} tabIndex={-1} className={`${s.dialog} ${className ?? ""}`} style={style}>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function ConfirmDialog({
  title,
  body,
  confirmLabel,
  danger,
  onConfirm,
  onCancel,
}: {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog onClose={onCancel} label={title} className={s.confirm} initialFocus="[data-confirm]">
      <h2 className={s.confirmTitle}>{title}</h2>
      <p className={s.confirmBody}>{body}</p>
      <div className={s.confirmActions}>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button data-confirm variant={danger ? "danger" : "primary"} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}
