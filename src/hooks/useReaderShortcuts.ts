import { useEffect, useMemo, useRef } from "react";
import { createMatcher, eventToKey, resolveBindings } from "../lib/shortcuts";
import { startReply, toggleImportant, toggleRead, toggleStar, usePicker } from "../state/actions";
import { useApp } from "../state/app";
import { hasExpandedSheet } from "../state/compose";
import { useMail } from "../state/mail";
import { closeReaderWindow, readerSnooze, readerSpam, readerTrash, runPrimaryMove } from "../state/readerWindow";

const isTyping = (el: Element | null) =>
  !!el && (el.matches("input, textarea, select") || (el as HTMLElement).isContentEditable);

/** The keys that make sense for one open email, using the user's own bindings. Everything else is ignored. */
export function useReaderShortcuts() {
  const overrides = useApp((s) => s.settings?.shortcuts);
  const bindings = useMemo(() => resolveBindings(overrides ?? {}), [overrides]);
  const ref = useRef(bindings);
  ref.current = bindings;

  useEffect(() => {
    const match = createMatcher(() => ref.current);
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      if (["Shift", "Control", "Alt", "Meta"].includes(e.key)) return;
      const key = eventToKey(e);

      // The composer, menus and pickers own the keyboard while they're open.
      if (isTyping(document.activeElement)) return;
      if (hasExpandedSheet()) return;
      if (document.querySelector("[role=dialog][aria-label]:not([data-passive])")) return;

      const action = match(key);
      if (!action || action === "pending") return;
      const m = useMail.getState();
      const id = m.openId;
      if (!id) return;
      const labelIds = m.threads.find((t) => t.id === id)?.labelIds ?? m.details[id]?.labelIds ?? [];
      switch (action) {
        case "reply":
        case "replyAll":
        case "forward":
          startReply(action);
          break;
        case "archive":
          runPrimaryMove(labelIds);
          break;
        case "trash":
          if (labelIds.includes("TRASH")) return;
          readerTrash();
          break;
        case "star":
          toggleStar();
          break;
        case "important":
          toggleImportant();
          break;
        case "toggleRead":
          toggleRead();
          break;
        case "snooze":
          readerSnooze();
          break;
        case "label":
          usePicker.getState().show("label", null, [id]);
          break;
        case "spam":
          if (labelIds.includes("SPAM")) return;
          readerSpam();
          break;
        case "back":
          closeReaderWindow();
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
