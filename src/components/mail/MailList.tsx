import { useVirtualizer } from "@tanstack/react-virtual";
import {
  AlarmClock,
  Archive,
  ArrowUpDown,
  Check,
  CircleAlert,
  Ellipsis,
  Funnel,
  Inbox,
  MailOpen,
  Paperclip,
  RefreshCw,
  SearchX,
  Send,
  Sparkles,
  Star,
  Tag,
  Trash2,
  WifiOff,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { viewTitle } from "../../lib/views";
import { compose, OPEN_DRAFT, toggleRead, toggleStar, usePicker } from "../../state/actions";
import { useApp } from "../../state/app";
import { sortThreads, useMail, type SortMode } from "../../state/mail";
import { anchorFrom, Menu, useMenu, type Anchor, type MenuEntry } from "../ui/Menu";
import { Button, EmptyState, IconButton, Skeleton, Spinner } from "../ui/primitives";
import { MailRow, type RowHandlers } from "./MailRow";
import s from "./mail.module.css";
import { threadMenuItems } from "./threadMenu";

const SORTS: { value: SortMode; label: string }[] = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "unread", label: "Unread first" },
  { value: "sender", label: "Sender (A–Z)" },
];

function SkeletonRows({ avatars }: { avatars: boolean }) {
  return (
    <div aria-busy="true" aria-label="Loading conversations">
      {Array.from({ length: 9 }, (_, i) => (
        <div key={i} className={s.skelRow} style={{ opacity: 1 - i * 0.09 }}>
          {avatars && <Skeleton width={34} height={34} style={{ borderRadius: "50%", flex: "none" }} />}
          <div className={s.skelBody}>
            <Skeleton width={`${38 + ((i * 17) % 30)}%`} height={11} />
            <Skeleton width={`${62 + ((i * 13) % 28)}%`} height={10} />
            <Skeleton width={`${80 - ((i * 11) % 25)}%`} height={9} />
          </div>
        </div>
      ))}
    </div>
  );
}

function emptyFor(kind: string, label: string): { icon: ReactNode; title: string; body: string; action?: ReactNode } {
  switch (kind) {
    case "label:INBOX":
      return { icon: <Sparkles size={30} />, title: "Inbox zero", body: "Nothing needs your attention. New mail will appear here as it arrives." };
    case "label:STARRED":
      return { icon: <Star size={30} />, title: "No starred mail", body: "Press S on any conversation to keep it here for later." };
    case "snoozed":
      return { icon: <AlarmClock size={30} />, title: "Nothing snoozed", body: "Press H to hide a conversation until a better time. It comes back to your inbox on its own." };
    case "label:SENT":
      return { icon: <Send size={30} />, title: "No sent mail yet", body: "Messages you send will be listed here.", action: <Button onClick={compose}>Write a message</Button> };
    case "label:DRAFT":
      return { icon: <MailOpen size={30} />, title: "No drafts", body: "Unsent messages are saved here automatically while you write." };
    case "label:SPAM":
      return { icon: <Check size={30} />, title: "No spam", body: "Gmail's filters are keeping things clean." };
    case "label:TRASH":
      return { icon: <Trash2 size={30} />, title: "Trash is empty", body: "Gmail deletes conversations here for good after 30 days." };
    case "archive":
      return { icon: <Archive size={30} />, title: "Nothing archived", body: "Press E to archive a conversation. It leaves your inbox but stays searchable." };
    default:
      if (kind.startsWith("search:")) return { icon: <SearchX size={30} />, title: "No matches", body: "Try fewer words, or search operators such as from:, has:attachment or older_than:1y." };
      return { icon: <Tag size={30} />, title: `Nothing in ${label}`, body: "Conversations with this label will appear here." };
  }
}

export function MailList({ full }: { full: boolean }) {
  const settings = useApp((a) => a.settings!);
  const accountId = useApp((a) => a.activeAccount);
  const labels = useApp((a) => (accountId ? a.labels[accountId] : undefined));
  const update = useApp((a) => a.updateSettings);
  const {
    view,
    threads,
    loading,
    loadingMore,
    nextPage,
    error,
    filters,
    sort,
    selectedId,
    checked,
    setFilters,
    setSort,
  } = useMail();
  const sorted = useMemo(() => sortThreads(threads, sort), [threads, sort]);
  const labelMap = useMemo(() => new Map((labels ?? []).map((l) => [l.id, l])), [labels]);
  const { menu, openAt, close } = useMenu();
  const [menuItems, setMenuItems] = useState<MenuEntry[]>([]);
  const [dragging, setDragging] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const compact = settings.density === "compact";
  const rowH = compact ? 52 : 82;

  const virt = useVirtualizer({
    count: sorted.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => rowH,
    overscan: 10,
  });
  useEffect(() => virt.measure(), [rowH, virt]);

  // Keep keyboard selection in view.
  useEffect(() => {
    const i = sorted.findIndex((t) => t.id === selectedId);
    if (i >= 0) virt.scrollToIndex(i, { align: "auto" });
  }, [selectedId, sorted, virt]);

  // Infinite scroll.
  const items = virt.getVirtualItems();
  const last = items[items.length - 1];
  useEffect(() => {
    if (last && last.index >= sorted.length - 6 && nextPage && !loadingMore) useMail.getState().loadMore();
  }, [last, sorted.length, nextPage, loadingMore]);

  const viewKind = view.kind === "label" ? `label:${view.labelId}` : view.kind === "search" ? `search:${view.query}` : view.kind;
  const title = viewTitle(view, (id) => labelMap.get(id)?.name.split("/").pop());
  const inboxUnread = view.kind === "label" ? labelMap.get(view.labelId)?.unread : undefined;
  const archivedView = view.kind === "archive" || (view.kind === "label" && (view.labelId === "TRASH" || view.labelId === "SPAM"));

  const showMenu = useCallback(
    (ids: string[], anchor: Anchor) => {
      setMenuItems(threadMenuItems(ids, useMail.getState().threads, useMail.getState().view, anchor));
      openAt(anchor);
    },
    [openAt],
  );

  const handlers: RowHandlers = useMemo(
    () => ({
      onClick: (t, e) => {
        const m = useMail.getState();
        if (e.shiftKey || e.ctrlKey || e.metaKey) return m.toggleCheck(t.id, e.shiftKey);
        if (m.checked.size) m.clearChecks();
        // In Drafts, a conversation opens straight into the composer.
        if (m.view.kind === "label" && m.view.labelId === "DRAFT") {
          useMail.setState({ selectedId: t.id });
          return window.dispatchEvent(new CustomEvent(OPEN_DRAFT, { detail: t.id }));
        }
        if (full) m.open(t.id);
        else m.select(t.id);
      },
      onDoubleClick: (t) => {
        if (!t.labelIds.includes("DRAFT") || useMail.getState().view.kind !== "label") useMail.getState().open(t.id);
      },
      onCheck: (t, range) => useMail.getState().toggleCheck(t.id, range),
      onContext: (t, e) => {
        const m = useMail.getState();
        const ids = m.checked.has(t.id) ? [...m.checked] : [t.id];
        if (!m.checked.has(t.id) && !full) m.select(t.id);
        showMenu(ids, { x: e.clientX, y: e.clientY });
      },
      onArchive: (t) => {
        const m = useMail.getState();
        const v = m.view;
        if (v.kind === "label" && v.labelId === "TRASH") m.restore([t.id]);
        else if (v.kind === "label" && v.labelId === "SPAM") m.notSpam([t.id]);
        else if (!t.labelIds.includes("INBOX")) m.moveToInbox([t.id]);
        else m.archive([t.id]);
      },
      onTrash: (t) => useMail.getState().trash([t.id]),
      onStar: (t) => useMail.getState().setStar([t.id], !t.starred),
      onRead: (t) => useMail.getState().setRead([t.id], t.unread),
    }),
    [full, showMenu],
  );

  const selectingMode = checked.size > 0;
  const ids = [...checked];

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = settings.listWidth;
    setDragging(true);
    const move = (ev: MouseEvent) => {
      const w = Math.max(320, Math.min(720, startW + ev.clientX - startX));
      document.documentElement.style.setProperty("--list-w", `${w}px`);
    };
    const up = (ev: MouseEvent) => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      setDragging(false);
      update({ listWidth: Math.max(320, Math.min(720, startW + ev.clientX - startX)) });
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
  };

  const filterItems: MenuEntry[] = [
    { kind: "header", label: "Show only" },
    { id: "unread", label: "Unread", icon: <MailOpen size={15} />, checked: filters.unread, onSelect: () => setFilters({ unread: !filters.unread }) },
    { id: "starred", label: "Starred", icon: <Star size={15} />, checked: filters.starred, onSelect: () => setFilters({ starred: !filters.starred }) },
    { id: "att", label: "With attachments", icon: <Paperclip size={15} />, checked: filters.attachments, onSelect: () => setFilters({ attachments: !filters.attachments }) },
  ];
  const sortItems: MenuEntry[] = [
    { kind: "header", label: "Sort loaded conversations" },
    ...SORTS.map((o) => ({ id: o.value, label: o.label, checked: sort === o.value, onSelect: () => setSort(o.value) })),
  ];
  const activeFilters = [
    filters.unread && { key: "unread" as const, label: "Unread" },
    filters.starred && { key: "starred" as const, label: "Starred" },
    filters.attachments && { key: "attachments" as const, label: "With attachments" },
  ].filter(Boolean) as { key: keyof typeof filters; label: string }[];

  let content: ReactNode;
  if (loading && !threads.length) content = <SkeletonRows avatars={settings.showAvatars && !compact} />;
  else if (error && !threads.length) {
    const offline = error.code === "offline";
    content = (
      <EmptyState
        icon={offline ? <WifiOff size={30} /> : <CircleAlert size={30} />}
        title={offline ? "You're offline" : "Couldn't load this mailbox"}
        body={error.message}
        action={
          <Button icon={<RefreshCw size={14} />} onClick={() => useMail.getState().reload()}>
            Try again
          </Button>
        }
      />
    );
  } else if (!threads.length) {
    const e = activeFilters.length
      ? { icon: <Funnel size={30} />, title: "Nothing matches these filters", body: "Clear a filter to see more conversations.", action: <Button onClick={() => setFilters({ unread: false, starred: false, attachments: false })}>Clear filters</Button> }
      : emptyFor(viewKind, title);
    content = <EmptyState {...e} />;
  } else {
    content = (
      <div style={{ height: virt.getTotalSize() + (nextPage ? 48 : 8), position: "relative" }} role="listbox" aria-label={title} aria-multiselectable>
        {items.map((vi) => {
          const t = sorted[vi.index];
          return (
            <MailRow
              key={t.id}
              t={t}
              style={{ top: vi.start, height: rowH - 2 }}
              selected={t.id === selectedId}
              checked={checked.has(t.id)}
              showAvatar={settings.showAvatars}
              showSnippet={settings.showSnippets}
              sentView={view.kind === "label" && (view.labelId === "SENT" || view.labelId === "DRAFT")}
              archived={archivedView || !t.labelIds.includes("INBOX")}
              labels={labelMap}
              h={handlers}
            />
          );
        })}
        {nextPage && (
          <div className={s.more} style={{ top: virt.getTotalSize() }}>
            {loadingMore ? <Spinner size={16} /> : null}
          </div>
        )}
      </div>
    );
  }

  return (
    <section className={s.list} data-full={full} data-selecting={selectingMode} style={full ? undefined : { width: `var(--list-w, ${settings.listWidth}px)` }} aria-label="Conversations">
      {selectingMode ? (
        <div className={s.bulk}>
          <IconButton label="Clear selection" keys="escape" onClick={() => useMail.getState().clearChecks()}>
            <X size={16} />
          </IconButton>
          <span className={s.bulkCount}>{checked.size} selected</span>
          <IconButton label="Select all loaded" keys="mod+a" onClick={() => useMail.getState().checkAll()}>
            <Check size={16} />
          </IconButton>
          <IconButton label={archivedView ? "Move to Inbox" : "Archive"} keys="e" onClick={() => (archivedView ? useMail.getState().moveToInbox(ids) : useMail.getState().archive(ids))}>
            {archivedView ? <Inbox size={16} /> : <Archive size={16} />}
          </IconButton>
          <IconButton label="Move to Trash" keys="#" onClick={() => useMail.getState().trash(ids)}>
            <Trash2 size={16} />
          </IconButton>
          <IconButton label="Mark read / unread" keys="u" onClick={toggleRead}>
            <MailOpen size={16} />
          </IconButton>
          <IconButton label="Star" keys="s" onClick={toggleStar}>
            <Star size={16} />
          </IconButton>
          <IconButton label="Snooze" keys="h" onClick={(e) => usePicker.getState().show("snooze", anchorFrom(e.currentTarget), ids)}>
            <AlarmClock size={16} />
          </IconButton>
          <IconButton label="More actions" onClick={(e) => showMenu(ids, anchorFrom(e.currentTarget))}>
            <Ellipsis size={16} />
          </IconButton>
        </div>
      ) : (
        <div className={s.header}>
          <div className={s.titleWrap}>
            <h1 className={s.title}>{title}</h1>
            <div className={s.subtitle}>
              {inboxUnread ? `${inboxUnread.toLocaleString()} unread` : threads.length ? `${threads.length}${nextPage ? "+" : ""} conversations` : " "}
            </div>
          </div>
          <div className={s.headerActions}>
            <IconButton label="Filter" active={activeFilters.length > 0} onClick={(e) => openAt(anchorFrom(e.currentTarget), "filter")}>
              <Funnel size={15} />
            </IconButton>
            <IconButton label="Sort" active={sort !== "newest"} onClick={(e) => openAt(anchorFrom(e.currentTarget), "sort")}>
              <ArrowUpDown size={15} />
            </IconButton>
          </div>
        </div>
      )}
      {activeFilters.length > 0 && !selectingMode && (
        <div className={s.chips}>
          {activeFilters.map((f) => (
            <span key={f.key} className={s.chip}>
              {f.label}
              <button aria-label={`Remove ${f.label} filter`} onClick={() => setFilters({ [f.key]: false })}>
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}
      <div ref={scroller} className={s.scroller} tabIndex={-1}>
        {content}
      </div>
      {!full && <div className={s.resizer} data-active={dragging} onMouseDown={startResize} role="separator" aria-orientation="vertical" aria-label="Resize list" />}
      {menu?.key === "menu" && <Menu anchor={menu.anchor} items={menuItems} onClose={close} />}
      {menu?.key === "filter" && <Menu anchor={menu.anchor} items={filterItems} onClose={close} align="end" />}
      {menu?.key === "sort" && <Menu anchor={menu.anchor} items={sortItems} onClose={close} align="end" />}
    </section>
  );
}
