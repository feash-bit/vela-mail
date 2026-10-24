// Keyboard shortcut registry. Bindings are strings such as "c", "shift+u",
// "mod+k" ("mod" is Ctrl on Linux) or two-key sequences like "g i".
// Users can override any binding in Settings → Shortcuts.

export type ShortcutAction =
  | "compose"
  | "search"
  | "palette"
  | "reply"
  | "replyAll"
  | "forward"
  | "archive"
  | "trash"
  | "star"
  | "important"
  | "toggleRead"
  | "snooze"
  | "label"
  | "spam"
  | "next"
  | "prev"
  | "open"
  | "openWindow"
  | "back"
  | "select"
  | "selectAll"
  | "undo"
  | "goInbox"
  | "goStarred"
  | "goSnoozed"
  | "goSent"
  | "goDrafts"
  | "goArchive"
  | "goSpam"
  | "goTrash"
  | "toggleSidebar"
  | "settings"
  | "help"
  | "refresh";

export interface ShortcutDef {
  action: ShortcutAction;
  label: string;
  group: "General" | "Navigation" | "Message actions" | "Go to";
  keys: string;
}

export const DEFAULT_SHORTCUTS: ShortcutDef[] = [
  { action: "compose", label: "New message", group: "General", keys: "c" },
  { action: "search", label: "Search mail", group: "General", keys: "/" },
  { action: "palette", label: "Command menu", group: "General", keys: "mod+k" },
  { action: "undo", label: "Undo last action", group: "General", keys: "z" },
  { action: "refresh", label: "Check for new mail", group: "General", keys: "shift+r" },
  { action: "toggleSidebar", label: "Collapse sidebar", group: "General", keys: "[" },
  { action: "settings", label: "Settings", group: "General", keys: "mod+," },
  { action: "help", label: "Keyboard shortcuts", group: "General", keys: "?" },

  { action: "next", label: "Next conversation", group: "Navigation", keys: "j, arrowdown" },
  { action: "prev", label: "Previous conversation", group: "Navigation", keys: "k, arrowup" },
  { action: "open", label: "Open conversation", group: "Navigation", keys: "enter" },
  { action: "openWindow", label: "Open in new window", group: "Navigation", keys: "shift+enter" },
  { action: "back", label: "Back / close", group: "Navigation", keys: "escape" },
  { action: "select", label: "Select conversation", group: "Navigation", keys: "x" },
  { action: "selectAll", label: "Select all", group: "Navigation", keys: "mod+a" },

  { action: "reply", label: "Reply", group: "Message actions", keys: "r" },
  { action: "replyAll", label: "Reply all", group: "Message actions", keys: "a" },
  { action: "forward", label: "Forward", group: "Message actions", keys: "f" },
  { action: "archive", label: "Archive", group: "Message actions", keys: "e" },
  { action: "trash", label: "Move to Trash", group: "Message actions", keys: "#, delete" },
  { action: "star", label: "Star / unstar", group: "Message actions", keys: "s" },
  { action: "important", label: "Mark important", group: "Message actions", keys: "=" },
  { action: "toggleRead", label: "Mark read / unread", group: "Message actions", keys: "u" },
  { action: "snooze", label: "Snooze", group: "Message actions", keys: "h" },
  { action: "label", label: "Apply label", group: "Message actions", keys: "l" },
  { action: "spam", label: "Report spam", group: "Message actions", keys: "!" },

  { action: "goInbox", label: "Inbox", group: "Go to", keys: "g i" },
  { action: "goStarred", label: "Starred", group: "Go to", keys: "g s" },
  { action: "goSnoozed", label: "Snoozed", group: "Go to", keys: "g h" },
  { action: "goSent", label: "Sent", group: "Go to", keys: "g t" },
  { action: "goDrafts", label: "Drafts", group: "Go to", keys: "g d" },
  { action: "goArchive", label: "Archive", group: "Go to", keys: "g a" },
  { action: "goSpam", label: "Spam", group: "Go to", keys: "g !" },
  { action: "goTrash", label: "Trash", group: "Go to", keys: "g #" },
];

/** Normalise a keyboard event to a binding string, e.g. "mod+shift+k". */
export function eventToKey(e: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">): string {
  let key = e.key;
  if (key === " ") key = "space";
  key = key.length === 1 ? key.toLowerCase() : key.toLowerCase();
  // Shifted symbols ("?", "#", "!") are their own key; don't add "shift+".
  const symbol = key.length === 1 && !/[a-z0-9]/.test(key);
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push("mod");
  if (e.altKey) parts.push("alt");
  if (e.shiftKey && !symbol) parts.push("shift");
  parts.push(key);
  return parts.join("+");
}

/** "j, arrowdown" → ["j", "arrowdown"]. Only ", " separates, so "mod+," still works. */
export function alternatives(binding: string): string[] {
  return binding
    .split(", ")
    .map((b) => b.trim().toLowerCase())
    .filter(Boolean);
}

export function resolveBindings(overrides: Record<string, string>): Map<string, ShortcutAction> {
  const map = new Map<string, ShortcutAction>();
  for (const d of DEFAULT_SHORTCUTS) {
    for (const keys of alternatives(overrides[d.action] ?? d.keys)) map.set(keys, d.action);
  }
  return map;
}

export function bindingFor(action: ShortcutAction, overrides: Record<string, string>): string {
  return overrides[action] ?? DEFAULT_SHORTCUTS.find((d) => d.action === action)?.keys ?? "";
}

/** Find bindings used by more than one action. */
export function conflicts(overrides: Record<string, string>): Map<string, ShortcutAction[]> {
  const seen = new Map<string, ShortcutAction[]>();
  for (const d of DEFAULT_SHORTCUTS) {
    for (const k of alternatives(overrides[d.action] ?? d.keys)) seen.set(k, [...(seen.get(k) ?? []), d.action]);
  }
  return new Map([...seen].filter(([, v]) => v.length > 1));
}

/**
 * Stateful matcher that understands two-key sequences ("g i").
 * Returns the action, "pending" while waiting for the second key, or null.
 */
export function createMatcher(getBindings: () => Map<string, ShortcutAction>, timeoutMs = 900) {
  let prefix: string | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (key: string): ShortcutAction | "pending" | null => {
    const bindings = getBindings();
    if (timer) clearTimeout(timer);
    if (prefix) {
      const seq = `${prefix} ${key}`;
      prefix = null;
      if (bindings.has(seq)) return bindings.get(seq)!;
    }
    const startsSequence = [...bindings.keys()].some((k) => k.startsWith(`${key} `));
    if (startsSequence) {
      prefix = key;
      timer = setTimeout(() => (prefix = null), timeoutMs);
      return "pending";
    }
    return bindings.get(key) ?? null;
  };
}

/** Pretty label for UI: "mod+shift+k" → ["Ctrl", "Shift", "K"]. */
export function keyCaps(binding: string): string[][] {
  const pretty: Record<string, string> = {
    mod: "Ctrl",
    shift: "Shift",
    alt: "Alt",
    enter: "Enter",
    escape: "Esc",
    space: "Space",
    arrowup: "↑",
    arrowdown: "↓",
    arrowleft: "←",
    arrowright: "→",
    backspace: "⌫",
    delete: "Del",
  };
  return binding
    .split(" ")
    .filter(Boolean)
    .map((chord) => chord.split("+").map((p) => pretty[p] ?? (p.length === 1 ? p.toUpperCase() : p)));
}
