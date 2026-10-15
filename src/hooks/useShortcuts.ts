import { useEffect, useMemo, useRef } from "react";
import { createMatcher, eventToKey, resolveBindings } from "../lib/shortcuts";
import { runAction } from "../state/actions";
import { useApp } from "../state/app";
import { hasExpandedSheet } from "../state/compose";

const isTyping = (el: Element | null) =>
  !!el && (el.matches("input, textarea, select") || (el as HTMLElement).isContentEditable);

/** Global keyboard handling. Ignored while typing, except for a few safe keys. */
export function useShortcuts() {
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
      const app = useApp.getState();
      const typing = isTyping(document.activeElement);

      // Dialogs and the focused composer own the keyboard.
      if (app.dialog && key !== "mod+k") return;
      if (typing && !["mod+k", "mod+,"].includes(key)) return;
      if (hasExpandedSheet() && !["mod+k"].includes(key)) return;
      if (document.querySelector("[role=dialog][aria-label]:not([data-passive])") && key !== "mod+k") return;

      const action = match(key);
      if (action === "pending") {
        e.preventDefault();
        return;
      }
      if (!action) return;
      // Let the browser keep normal select-all when nothing is in the list.
      e.preventDefault();
      runAction(action);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
