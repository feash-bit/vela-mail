import {
  AlarmClock,
  Archive,
  Check,
  ChevronDown,
  ChevronsUpDown,
  File,
  Inbox,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Send,
  Settings,
  ShieldAlert,
  SquarePen,
  Star,
  Tag,
  Trash2,
} from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { nameOf } from "../../lib/format";
import type { Label } from "../../lib/types";
import { FOLDERS, viewKey, type FolderId } from "../../lib/views";
import { compose } from "../../state/actions";
import { useApp } from "../../state/app";
import { useMail } from "../../state/mail";
import { anchorFrom, Popover, type Anchor } from "../ui/Menu";
import { Avatar, IconButton } from "../ui/primitives";
import { Tooltip } from "../ui/Tooltip";
import { LogoMark } from "./LogoMark";
import { useSignIn } from "./SignIn";
import s from "./sidebar.module.css";

const ICONS: Record<FolderId, ReactNode> = {
  inbox: <Inbox size={16} />,
  starred: <Star size={16} />,
  snoozed: <AlarmClock size={16} />,
  sent: <Send size={16} />,
  drafts: <File size={16} />,
  archive: <Archive size={16} />,
  spam: <ShieldAlert size={16} />,
  trash: <Trash2 size={16} />,
};

const KEYS: Partial<Record<FolderId, string>> = { inbox: "g i", starred: "g s", snoozed: "g h", sent: "g t", drafts: "g d", archive: "g a" };

interface LabelNode {
  label: Label;
  short: string;
  children: LabelNode[];
}

function buildTree(labels: Label[]): LabelNode[] {
  const byName = new Map<string, LabelNode>();
  const roots: LabelNode[] = [];
  for (const l of [...labels].sort((a, b) => a.name.localeCompare(b.name))) {
    const parts = l.name.split("/");
    const node: LabelNode = { label: l, short: parts[parts.length - 1], children: [] };
    byName.set(l.name, node);
    const parent = byName.get(parts.slice(0, -1).join("/"));
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

function NavItem({
  icon,
  name,
  count,
  muted,
  current,
  compact,
  keys,
  onClick,
}: {
  icon: ReactNode;
  name: string;
  count?: number;
  muted?: boolean;
  current: boolean;
  compact: boolean;
  keys?: string;
  onClick: () => void;
}) {
  const btn = (
    <button className={s.item} aria-current={current ? "page" : undefined} onClick={onClick}>
      {icon}
      <span className={s.itemName}>{name}</span>
      {!!count && <span className={`${s.count} ${muted ? s.countMuted : ""}`}>{count > 999 ? "999+" : count}</span>}
      {!!count && !muted && <span className={s.dot} />}
    </button>
  );
  return compact ? (
    <Tooltip label={count ? `${name} · ${count}` : name} keys={keys} side="bottom">
      {btn}
    </Tooltip>
  ) : (
    btn
  );
}

function LabelTree({ nodes, compact, current }: { nodes: LabelNode[]; compact: boolean; current: string }) {
  const setView = useMail((m) => m.setView);
  return (
    <>
      {nodes.map((n) => (
        <div key={n.label.id}>
          <NavItem
            icon={n.label.color ? <span className={s.labelDot} style={{ background: n.label.color.background }} /> : <Tag size={15} />}
            name={compact ? n.label.name : n.short}
            count={n.label.unread}
            current={current === `label:${n.label.id}`}
            compact={compact}
            onClick={() => setView({ kind: "label", labelId: n.label.id })}
          />
          {n.children.length > 0 && (
            <div className={s.labelChildren}>
              <LabelTree nodes={n.children} compact={compact} current={current} />
            </div>
          )}
        </div>
      ))}
    </>
  );
}

function readPref(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === "1";
  } catch {
    return fallback;
  }
}

function AccountSwitcher({ compact }: { compact: boolean }) {
  const accounts = useApp((a) => a.accounts);
  const activeId = useApp((a) => a.activeAccount);
  const identities = useApp((a) => a.identities);
  const setActive = useApp((a) => a.setActiveAccount);
  const openDialog = useApp((a) => a.openDialog);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const { start, dialog } = useSignIn();
  const active = accounts.find((a) => a.id === activeId);
  if (!active) return null;
  const display = (id: string, fallback: string | null, email: string) => identities[id]?.displayName ?? fallback ?? nameOf({ name: null, email });

  return (
    <>
      <button className={s.account} onClick={(e) => setAnchor(anchorFrom(e.currentTarget))} aria-label="Switch account" aria-haspopup="menu">
        <span className={s.avatarWrap}>
          <Avatar name={display(active.id, active.displayName, active.email)} email={active.email} size={28} />
          {active.status !== "ok" && <span className={s.statusDot} />}
        </span>
        <span className={s.accountText}>
          <span className={s.accountName}>{display(active.id, active.displayName, active.email)}</span>
          <span className={s.accountEmail}>{active.email}</span>
        </span>
        <ChevronsUpDown size={14} className={s.accountChevron} />
      </button>
      {anchor && (
        <Popover anchor={{ ...anchor, y: anchor.y - 8 }} onClose={() => setAnchor(null)} width={compact ? 260 : Math.max(anchor.w ?? 0, 240)} label="Accounts">
          {accounts.map((a) => (
            <button
              key={a.id}
              className={s.acctRow}
              onClick={() => {
                setAnchor(null);
                if (a.id !== activeId) setActive(a.id);
              }}
            >
              <Avatar name={display(a.id, a.displayName, a.email)} email={a.email} size={28} />
              <span className={s.accountText}>
                <span className={s.accountName}>{display(a.id, a.displayName, a.email)}</span>
                <span className={s.accountEmail}>{a.status === "needsReauth" ? "Sign in again to sync" : a.email}</span>
              </span>
              {a.id === activeId && <Check size={15} className={s.acctCheck} />}
            </button>
          ))}
          <div style={{ height: 1, background: "var(--line)", margin: "5px 6px" }} />
          <button
            className={s.acctRow}
            onClick={() => {
              setAnchor(null);
              start();
            }}
          >
            <Plus size={16} style={{ margin: "0 6px", color: "var(--text-3)" }} />
            <span className={s.accountName} style={{ fontWeight: 500 }}>
              Add another account
            </span>
          </button>
          <button
            className={s.acctRow}
            onClick={() => {
              setAnchor(null);
              openDialog("settings", "accounts");
            }}
          >
            <LogOut size={15} style={{ margin: "0 6px", color: "var(--text-3)" }} />
            <span className={s.accountName} style={{ fontWeight: 500 }}>
              Manage accounts
            </span>
          </button>
        </Popover>
      )}
      {dialog}
    </>
  );
}

export function Sidebar() {
  const settings = useApp((a) => a.settings!);
  const accountId = useApp((a) => a.activeAccount);
  const labels = useApp((a) => (accountId ? a.labels[accountId] : undefined));
  const update = useApp((a) => a.updateSettings);
  const openDialog = useApp((a) => a.openDialog);
  const view = useMail((m) => m.view);
  const setView = useMail((m) => m.setView);
  const compact = settings.sidebarCompact;
  const current = viewKey(view);
  const [labelsOpen, setLabelsOpen] = useState(() => readPref("vela.labelsOpen", true));

  const byId = useMemo(() => new Map((labels ?? []).map((l) => [l.id, l])), [labels]);
  const tree = useMemo(() => buildTree((labels ?? []).filter((l) => l.kind === "user")), [labels]);

  const toggleLabels = () => {
    setLabelsOpen((v) => {
      try {
        localStorage.setItem("vela.labelsOpen", v ? "0" : "1");
      } catch {
        /* storage unavailable: keep in memory only */
      }
      return !v;
    });
  };

  return (
    <nav className={s.sidebar} data-compact={compact} aria-label="Mailboxes">
      <div className={s.top} data-tauri-drag-region={settings.customTitleBar ? "" : undefined}>
        <LogoMark className={s.logo} />
        <span className={s.wordmark} data-tauri-drag-region={settings.customTitleBar ? "" : undefined}>
          Vela
        </span>
        <span className={s.collapse}>
          <IconButton label="Collapse sidebar" keys="[" small onClick={() => update({ sidebarCompact: true })}>
            <PanelLeftClose size={15} />
          </IconButton>
        </span>
      </div>

      <Tooltip label="New message" keys="c">
        <button className={s.compose} onClick={compose}>
          <SquarePen size={16} />
          <span>New message</span>
          <kbd>C</kbd>
        </button>
      </Tooltip>

      <div className={s.scroll}>
        {FOLDERS.filter((f) => !settings.hiddenFolders.includes(f.id)).map((f) => {
          const label = f.countLabel ? byId.get(f.countLabel) : undefined;
          const count = label ? (f.countTotal ? label.total : label.unread) : undefined;
          return (
            <NavItem
              key={f.id}
              icon={ICONS[f.id]}
              name={f.name}
              count={count}
              muted={f.countTotal || f.id === "spam"}
              current={current === viewKey(f.view)}
              compact={compact}
              keys={KEYS[f.id]}
              onClick={() => setView(f.view)}
            />
          );
        })}

        {tree.length > 0 && (
          <>
            <button className={s.section} aria-expanded={labelsOpen} onClick={toggleLabels}>
              <span>Labels</span>
              <ChevronDown size={12} />
            </button>
            {labelsOpen && <LabelTree nodes={tree} compact={compact} current={current} />}
          </>
        )}
      </div>

      <div className={s.footer}>
        <AccountSwitcher compact={compact} />
        {compact ? (
          <IconButton label="Expand sidebar" keys="[" onClick={() => update({ sidebarCompact: false })}>
            <PanelLeftOpen size={16} />
          </IconButton>
        ) : null}
        <IconButton label="Settings" keys="mod+," onClick={() => openDialog("settings")}>
          <Settings size={16} />
        </IconButton>
      </div>
    </nav>
  );
}
