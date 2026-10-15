import {
  AlarmClock,
  Archive,
  ArrowRight,
  Command,
  Inbox,
  Keyboard,
  Mail,
  Moon,
  PanelLeft,
  RefreshCw,
  Reply,
  ReplyAll,
  Forward,
  Search,
  Settings,
  SquarePen,
  Star,
  Sun,
  Tag,
  Trash2,
  User,
  Rows2,
  Columns2,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { bindingFor, type ShortcutAction } from "../../lib/shortcuts";
import { FOLDERS } from "../../lib/views";
import { runAction } from "../../state/actions";
import { useApp } from "../../state/app";
import { useMail } from "../../state/mail";
import { Dialog } from "../ui/Dialog";
import { Kbd } from "../ui/Kbd";
import o from "./overlays.module.css";

interface Cmd {
  id: string;
  group: string;
  label: string;
  icon: ReactNode;
  keys?: string;
  run: () => void;
  words?: string;
}

function score(c: Cmd, q: string): number {
  if (!q) return 1;
  const hay = `${c.label} ${c.words ?? ""} ${c.group}`.toLowerCase();
  const needle = q.toLowerCase().trim();
  if (c.label.toLowerCase().startsWith(needle)) return 3;
  if (hay.includes(needle)) return 2;
  // Loose subsequence match ("arch" → "Archive", "gsn" → "Go to Snoozed").
  let i = 0;
  for (const ch of hay) if (ch === needle[i]) i++;
  return i === needle.length ? 1 : 0;
}

export function CommandPalette() {
  const close = () => useApp.getState().openDialog(null);
  const settings = useApp((a) => a.settings!);
  const accounts = useApp((a) => a.accounts);
  const accountId = useApp((a) => a.activeAccount);
  const labels = useApp((a) => (accountId ? a.labels[accountId] : undefined));
  const hasThread = useMail((m) => !!(m.openId ?? m.selectedId) || m.checked.size > 0);
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const k = (a: ShortcutAction) => bindingFor(a, settings.shortcuts).split(", ")[0];
  const act = (a: ShortcutAction) => () => runAction(a);

  const cmds = useMemo<Cmd[]>(() => {
    const list: Cmd[] = [
      { id: "compose", group: "Actions", label: "New message", icon: <SquarePen size={16} />, keys: k("compose"), run: act("compose"), words: "write compose email" },
      { id: "search", group: "Actions", label: "Search mail", icon: <Search size={16} />, keys: k("search"), run: act("search"), words: "find" },
      { id: "refresh", group: "Actions", label: "Check for new mail", icon: <RefreshCw size={16} />, keys: k("refresh"), run: act("refresh"), words: "sync refresh" },
    ];
    if (hasThread)
      list.push(
        { id: "reply", group: "Conversation", label: "Reply", icon: <Reply size={16} />, keys: k("reply"), run: act("reply") },
        { id: "replyAll", group: "Conversation", label: "Reply all", icon: <ReplyAll size={16} />, keys: k("replyAll"), run: act("replyAll") },
        { id: "forward", group: "Conversation", label: "Forward", icon: <Forward size={16} />, keys: k("forward"), run: act("forward") },
        { id: "archive", group: "Conversation", label: "Archive", icon: <Archive size={16} />, keys: k("archive"), run: act("archive"), words: "done" },
        { id: "trash", group: "Conversation", label: "Move to Trash", icon: <Trash2 size={16} />, keys: k("trash"), run: act("trash"), words: "delete remove" },
        { id: "star", group: "Conversation", label: "Star or unstar", icon: <Star size={16} />, keys: k("star"), run: act("star"), words: "favourite flag" },
        { id: "read", group: "Conversation", label: "Mark read or unread", icon: <Mail size={16} />, keys: k("toggleRead"), run: act("toggleRead") },
        { id: "snooze", group: "Conversation", label: "Snooze…", icon: <AlarmClock size={16} />, keys: k("snooze"), run: act("snooze"), words: "remind later" },
        { id: "label", group: "Conversation", label: "Apply labels…", icon: <Tag size={16} />, keys: k("label"), run: act("label"), words: "tag folder move" },
      );
    for (const f of FOLDERS)
      list.push({
        id: `go-${f.id}`,
        group: "Go to",
        label: f.name,
        icon: f.id === "inbox" ? <Inbox size={16} /> : <ArrowRight size={16} />,
        keys: k(`go${f.id[0].toUpperCase()}${f.id.slice(1)}` as ShortcutAction) || undefined,
        run: () => useMail.getState().setView(f.view),
        words: "go open folder",
      });
    for (const l of (labels ?? []).filter((x) => x.kind === "user"))
      list.push({ id: `label-${l.id}`, group: "Labels", label: l.name, icon: <Tag size={16} />, run: () => useMail.getState().setView({ kind: "label", labelId: l.id }), words: "label" });
    for (const a of accounts.filter((x) => x.id !== accountId))
      list.push({ id: `acct-${a.id}`, group: "Accounts", label: `Switch to ${a.email}`, icon: <User size={16} />, run: () => useApp.getState().setActiveAccount(a.id), words: "account switch" });
    const upd = useApp.getState().updateSettings;
    list.push(
      {
        id: "theme",
        group: "View",
        label: settings.theme === "dark" ? "Switch to light theme" : "Switch to dark theme",
        icon: settings.theme === "dark" ? <Sun size={16} /> : <Moon size={16} />,
        run: () => upd({ theme: settings.theme === "dark" ? "light" : "dark" }),
        words: "appearance mode",
      },
      {
        id: "layout",
        group: "View",
        label: settings.readerLayout === "split" ? "Use full-width reading" : "Use split view",
        icon: settings.readerLayout === "split" ? <Rows2 size={16} /> : <Columns2 size={16} />,
        run: () => upd({ readerLayout: settings.readerLayout === "split" ? "full" : "split" }),
        words: "layout pane reader",
      },
      {
        id: "density",
        group: "View",
        label: settings.density === "compact" ? "Comfortable rows" : "Compact rows",
        icon: <Rows2 size={16} />,
        run: () => upd({ density: settings.density === "compact" ? "comfortable" : "compact" }),
        words: "density dense",
      },
      { id: "sidebar", group: "View", label: "Toggle sidebar", icon: <PanelLeft size={16} />, keys: k("toggleSidebar"), run: act("toggleSidebar") },
      { id: "settings", group: "App", label: "Settings", icon: <Settings size={16} />, keys: k("settings"), run: act("settings"), words: "preferences options" },
      { id: "help", group: "App", label: "Keyboard shortcuts", icon: <Keyboard size={16} />, keys: k("help"), run: act("help"), words: "help keys" },
    );
    return list;
    // `k`/`act` are stable helpers derived from settings.
  }, [hasThread, labels, accounts, accountId, settings]);

  const results = cmds
    .map((c) => ({ c, sc: score(c, q) }))
    .filter((x) => x.sc > 0)
    .sort((a, b) => b.sc - a.sc)
    .map((x) => x.c)
    .slice(0, 40);

  const run = (c: Cmd | undefined) => {
    if (!c) return;
    close();
    // Let the dialog close first so focus returns to the app.
    setTimeout(c.run, 0);
  };

  let lastGroup = "";
  return (
    <Dialog onClose={close} label="Command menu" className={o.palette}>
      <div className={o.paletteInputRow}>
        <Command size={18} />
        <input
          className={o.paletteInput}
          autoFocus
          placeholder="Type a command or search…"
          value={q}
          aria-label="Command"
          onChange={(e) => (setQ(e.target.value), setActive(0))}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") setActive((a) => Math.min(results.length - 1, a + 1));
            else if (e.key === "ArrowUp") setActive((a) => Math.max(0, a - 1));
            else if (e.key === "Enter") run(results[active]);
            else return;
            e.preventDefault();
          }}
        />
      </div>
      <div className={o.paletteList} role="listbox">
        {results.length === 0 && (
          <div className={o.paletteEmpty}>
            No commands match. Press Enter in the search bar to search your mail for “{q}”.
          </div>
        )}
        {results.map((c, i) => {
          const header = !q && c.group !== lastGroup ? c.group : null;
          lastGroup = c.group;
          return (
            <div key={c.id}>
              {header && <div className={o.paletteGroup}>{header}</div>}
              <button className={o.paletteItem} role="option" aria-selected={i === active} data-active={i === active} onMouseMove={() => setActive(i)} onClick={() => run(c)}>
                {c.icon}
                <span>{c.label}</span>
                {c.keys && <Kbd keys={c.keys} />}
              </button>
            </div>
          );
        })}
      </div>
    </Dialog>
  );
}
