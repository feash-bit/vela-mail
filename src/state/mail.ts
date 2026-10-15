import { create } from "zustand";
import { api, toAppErr } from "../lib/ipc";
import type { AppErr, MailChanged, ThreadDetail, ThreadSummary, View } from "../lib/types";
import { viewKey } from "../lib/views";
import { useApp } from "./app";

export type SortMode = "newest" | "oldest" | "unread" | "sender";
export interface Filters {
  unread: boolean;
  starred: boolean;
  attachments: boolean;
}

interface Undo {
  label: string;
  revert: () => Promise<void>;
}

interface MailStore {
  view: View;
  threads: ThreadSummary[];
  nextPage: string | null;
  loading: boolean;
  loadingMore: boolean;
  refreshing: boolean;
  error: AppErr | null;
  filters: Filters;
  sort: SortMode;
  selectedId: string | null;
  /** In "full" reader layout: the conversation currently open over the list. */
  openId: string | null;
  checked: Set<string>;
  details: Record<string, ThreadDetail>;
  detailLoading: string | null;
  detailError: AppErr | null;
  undo: Undo | null;

  setView: (v: View) => void;
  reload: (opts?: { silent?: boolean }) => Promise<void>;
  loadMore: () => Promise<void>;
  setFilters: (f: Partial<Filters>) => void;
  setSort: (s: SortMode) => void;
  select: (id: string | null) => void;
  open: (id: string | null) => void;
  move: (delta: number) => void;
  toggleCheck: (id: string, range?: boolean) => void;
  checkAll: () => void;
  clearChecks: () => void;
  loadDetail: (id: string, opts?: { allowRemote?: boolean; silent?: boolean }) => Promise<void>;

  modify: (ids: string[], add: string[], remove: string[], message?: string, undoable?: boolean) => Promise<void>;
  archive: (ids: string[]) => Promise<void>;
  moveToInbox: (ids: string[]) => Promise<void>;
  trash: (ids: string[]) => Promise<void>;
  restore: (ids: string[]) => Promise<void>;
  spam: (ids: string[]) => Promise<void>;
  notSpam: (ids: string[]) => Promise<void>;
  setStar: (ids: string[], on: boolean) => Promise<void>;
  setImportant: (ids: string[], on: boolean) => Promise<void>;
  setRead: (ids: string[], read: boolean) => Promise<void>;
  snooze: (ids: string[], until: number | null) => Promise<void>;
  runUndo: () => Promise<void>;
  applyChanged: (e: MailChanged) => void;
}

let seq = 0;
let lastChecked: string | null = null;

const account = () => useApp.getState().activeAccount;

function filterQuery(f: Filters): string | null {
  const parts = [f.unread && "is:unread", f.starred && "is:starred", f.attachments && "has:attachment"].filter(Boolean);
  return parts.length ? parts.join(" ") : null;
}

/** Would a thread with these labels still be listed in this view? */
function belongs(view: View, labels: string[]): boolean {
  const has = (l: string) => labels.includes(l);
  switch (view.kind) {
    case "label":
      return has(view.labelId);
    case "archive":
      return !has("INBOX") && !has("SPAM") && !has("TRASH");
    case "snoozed":
      return !has("INBOX") && !has("TRASH");
    case "search":
      return !has("TRASH") && !has("SPAM");
  }
}

function withLabels(t: ThreadSummary, add: string[], remove: string[]): ThreadSummary {
  const labels = [...t.labelIds.filter((l) => !remove.includes(l)), ...add.filter((l) => !t.labelIds.includes(l))];
  return {
    ...t,
    labelIds: labels,
    unread: labels.includes("UNREAD"),
    starred: labels.includes("STARRED"),
    important: labels.includes("IMPORTANT"),
  };
}

let labelTimer: ReturnType<typeof setTimeout> | null = null;
function refreshCounts() {
  if (labelTimer) clearTimeout(labelTimer);
  labelTimer = setTimeout(() => useApp.getState().loadLabels(), 700);
}

export const useMail = create<MailStore>((set, get) => {
  /** Remove threads that left the view, keeping the cursor on a sensible neighbour. */
  function applyLocal(ids: string[], update: (t: ThreadSummary) => ThreadSummary | null) {
    const { threads, selectedId, view, openId } = get();
    const idx = selectedId ? threads.findIndex((t) => t.id === selectedId) : -1;
    const next: ThreadSummary[] = [];
    for (const t of threads) {
      if (!ids.includes(t.id)) {
        next.push(t);
        continue;
      }
      const u = update(t);
      if (u && belongs(view, u.labelIds)) next.push(u);
    }
    let sel = selectedId;
    if (selectedId && !next.some((t) => t.id === selectedId)) {
      // Auto-advance to the conversation that took its place.
      const after = threads.slice(idx + 1).find((t) => next.some((n) => n.id === t.id));
      const before = [...threads.slice(0, Math.max(idx, 0))].reverse().find((t) => next.some((n) => n.id === t.id));
      sel = (after ?? before)?.id ?? null;
    }
    const checked = new Set([...get().checked].filter((id) => next.some((t) => t.id === id)));
    set({
      threads: next,
      selectedId: sel,
      checked,
      openId: openId && !next.some((t) => t.id === openId) ? null : openId,
    });
  }

  async function guarded(snapshot: Partial<MailStore>, fn: () => Promise<void>, fail: string) {
    try {
      await fn();
      refreshCounts();
    } catch (e) {
      set(snapshot as MailStore);
      useApp.getState().error(e, fail);
      throw e;
    }
  }

  function offerUndo(message: string, revert: () => Promise<void>) {
    const undo = { label: message, revert };
    set({ undo });
    useApp.getState().toast(message, { action: { label: "Undo", run: () => get().runUndo() } });
  }

  const snap = () => ({ threads: get().threads, selectedId: get().selectedId, openId: get().openId, checked: get().checked });

  return {
    view: { kind: "label", labelId: "INBOX" },
    threads: [],
    nextPage: null,
    loading: false,
    loadingMore: false,
    refreshing: false,
    error: null,
    filters: { unread: false, starred: false, attachments: false },
    sort: "newest",
    selectedId: null,
    openId: null,
    checked: new Set(),
    details: {},
    detailLoading: null,
    detailError: null,
    undo: null,

    setView: (view) => {
      const same = viewKey(view) === viewKey(get().view);
      set({ view, selectedId: null, openId: null, checked: new Set(), ...(same ? {} : { threads: [], nextPage: null }) });
      if (view.kind !== "search") useApp.getState().updateSettings({ lastView: viewKey(view) });
      get().reload();
    },

    reload: async ({ silent } = {}) => {
      const acct = account();
      if (!acct) return;
      const my = ++seq;
      const { view, filters } = get();
      const filter = filterQuery(filters);
      if (!silent) {
        set({ loading: get().threads.length === 0, refreshing: true, error: null });
        // Instant first paint from the local cache while Gmail answers.
        if (!filter && get().threads.length === 0) {
          api
            .cachedThreads(acct, view)
            .then((cached) => {
              if (seq === my && get().loading && cached.length) set({ threads: cached, loading: false });
            })
            .catch(() => {});
        }
      }
      try {
        const page = await api.listThreads(acct, view, null, filter);
        if (seq !== my) return;
        const old = get().threads;
        // Keep pages already loaded beyond the first, so a background refresh doesn't jump.
        const oldest = page.threads.length ? Math.min(...page.threads.map((t) => t.date)) : Infinity;
        const tail = silent && page.nextPageToken ? old.filter((t) => t.date < oldest && !page.threads.some((p) => p.id === t.id)) : [];
        set({
          threads: [...page.threads, ...tail],
          nextPage: silent && tail.length ? get().nextPage : page.nextPageToken,
          loading: false,
          refreshing: false,
          error: null,
        });
      } catch (e) {
        if (seq !== my) return;
        const err = toAppErr(e);
        set({ loading: false, refreshing: false, error: silent && get().threads.length ? get().error : err });
      }
    },

    loadMore: async () => {
      const { nextPage, loadingMore, view, filters } = get();
      const acct = account();
      if (!nextPage || loadingMore || !acct) return;
      const my = seq;
      set({ loadingMore: true });
      try {
        const page = await api.listThreads(acct, view, nextPage, filterQuery(filters));
        if (seq !== my) return;
        const existing = new Set(get().threads.map((t) => t.id));
        set({ threads: [...get().threads, ...page.threads.filter((t) => !existing.has(t.id))], nextPage: page.nextPageToken, loadingMore: false });
      } catch (e) {
        set({ loadingMore: false });
        useApp.getState().error(e, "Couldn't load more conversations.");
      }
    },

    setFilters: (f) => {
      set({ filters: { ...get().filters, ...f }, threads: [], selectedId: null, checked: new Set() });
      get().reload();
    },

    setSort: (sort) => set({ sort }),

    select: (id) => {
      set({ selectedId: id });
      const layout = useApp.getState().settings?.readerLayout ?? "split";
      if (id && layout === "split") get().loadDetail(id);
    },

    open: (id) => {
      set({ openId: id, selectedId: id ?? get().selectedId });
      if (id) get().loadDetail(id);
    },

    move: (delta) => {
      const list = sortThreads(get().threads, get().sort);
      if (!list.length) return;
      const i = list.findIndex((t) => t.id === get().selectedId);
      const nextIdx = i < 0 ? 0 : Math.max(0, Math.min(list.length - 1, i + delta));
      const id = list[nextIdx].id;
      if (get().openId) get().open(id);
      else get().select(id);
      if (nextIdx >= list.length - 5) get().loadMore();
    },

    toggleCheck: (id, range) => {
      const checked = new Set(get().checked);
      if (range && lastChecked) {
        const list = sortThreads(get().threads, get().sort);
        const a = list.findIndex((t) => t.id === lastChecked);
        const b = list.findIndex((t) => t.id === id);
        if (a >= 0 && b >= 0) for (let i = Math.min(a, b); i <= Math.max(a, b); i++) checked.add(list[i].id);
      } else if (checked.has(id)) checked.delete(id);
      else checked.add(id);
      lastChecked = id;
      set({ checked });
    },

    checkAll: () => set({ checked: new Set(get().threads.map((t) => t.id)) }),
    clearChecks: () => set({ checked: new Set() }),

    loadDetail: async (id, { allowRemote, silent } = {}) => {
      const acct = account();
      if (!acct) return;
      const settings = useApp.getState().settings;
      const summary = get().threads.find((t) => t.id === id);
      const trusted = summary && settings?.trustedSenders.includes(summary.from.email.toLowerCase());
      const remote = allowRemote ?? (!settings?.blockRemoteImages || !!trusted || !!get().details[id]?.remoteAllowed);
      if (!silent) set({ detailLoading: get().details[id] ? null : id, detailError: null });
      try {
        const d = await api.getThread(acct, id, remote);
        set((s) => ({ details: { ...s.details, [id]: d }, detailLoading: s.detailLoading === id ? null : s.detailLoading }));
        const t = get().threads.find((x) => x.id === id);
        if (t?.unread && settings?.markReadOnOpen && (get().selectedId === id || get().openId === id)) {
          get().setRead([id], true);
        }
      } catch (e) {
        if (!silent) set({ detailLoading: null, detailError: toAppErr(e) });
      }
    },

    modify: async (ids, add, remove, message, undoable = false) => {
      const acct = account();
      if (!acct || !ids.length) return;
      const before = snap();
      applyLocal(ids, (t) => withLabels(t, add, remove));
      await guarded(before, () => api.modifyThreads(acct, ids, add, remove), "Couldn't update that conversation.");
      if (message && undoable) {
        offerUndo(message, async () => {
          set(before);
          await api.modifyThreads(acct, ids, remove, add);
          refreshCounts();
        });
      }
    },

    archive: (ids) => get().modify(ids, [], ["INBOX"], ids.length > 1 ? `Archived ${ids.length} conversations` : "Archived", true),
    moveToInbox: (ids) => get().modify(ids, ["INBOX"], ["SPAM"], "Moved to Inbox", true),
    spam: (ids) => get().modify(ids, ["SPAM"], ["INBOX"], ids.length > 1 ? `Reported ${ids.length} as spam` : "Reported as spam", true),
    notSpam: (ids) => get().modify(ids, ["INBOX"], ["SPAM"], "Moved to Inbox", true),
    setStar: (ids, on) => get().modify(ids, on ? ["STARRED"] : [], on ? [] : ["STARRED"]),
    setImportant: (ids, on) => get().modify(ids, on ? ["IMPORTANT"] : [], on ? [] : ["IMPORTANT"], on ? "Marked important" : "Marked not important"),
    setRead: (ids, read) => get().modify(ids, read ? [] : ["UNREAD"], read ? ["UNREAD"] : []),

    trash: async (ids) => {
      const acct = account();
      if (!acct || !ids.length) return;
      const before = snap();
      applyLocal(ids, (t) => (get().view.kind === "label" && (get().view as { labelId: string }).labelId === "TRASH" ? t : withLabels(t, ["TRASH"], ["INBOX"])));
      await guarded(before, () => api.trashThreads(acct, ids), "Couldn't move to Trash.");
      offerUndo(ids.length > 1 ? `Moved ${ids.length} conversations to Trash` : "Moved to Trash", async () => {
        set(before);
        await api.trashThreads(acct, ids, true);
        refreshCounts();
      });
    },

    restore: async (ids) => {
      const acct = account();
      if (!acct) return;
      const before = snap();
      applyLocal(ids, (t) => withLabels(t, [], ["TRASH"]));
      await guarded(before, () => api.trashThreads(acct, ids, true), "Couldn't restore.");
      useApp.getState().toast("Restored from Trash");
    },

    snooze: async (ids, until) => {
      const acct = account();
      if (!acct || !ids.length) return;
      const before = snap();
      applyLocal(ids, (t) => (until ? { ...withLabels(t, [], ["INBOX"]), snoozedUntil: until } : { ...withLabels(t, ["INBOX"], []), snoozedUntil: null }));
      await guarded(before, () => api.snoozeThreads(acct, ids, until), "Couldn't snooze.");
      if (until) {
        const when = new Date(until).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
        offerUndo(`Snoozed until ${when}`, async () => {
          set(before);
          await api.snoozeThreads(acct, ids, null);
        });
      } else useApp.getState().toast("Moved back to Inbox");
    },

    runUndo: async () => {
      const u = get().undo;
      if (!u) return;
      set({ undo: null });
      try {
        await u.revert();
        useApp.getState().toast("Undone");
      } catch (e) {
        useApp.getState().error(e, "Couldn't undo.");
        get().reload({ silent: true });
      }
    },

    applyChanged: (e) => {
      if (e.accountId !== account()) {
        if (e.labelsChanged) useApp.getState().loadLabels(e.accountId);
        return;
      }
      if (e.labelsChanged || e.fullRefresh) refreshCounts();
      get().reload({ silent: true });
      const open = get().openId ?? get().selectedId;
      if (open && (e.fullRefresh || e.threadIds.includes(open))) get().loadDetail(open, { silent: true });
      // Drop stale bodies for other changed threads.
      const details = { ...get().details };
      for (const id of e.threadIds) if (id !== open) delete details[id];
      set({ details });
    },
  };
});

export function sortThreads(list: ThreadSummary[], mode: SortMode): ThreadSummary[] {
  if (mode === "newest") return list;
  const copy = [...list];
  if (mode === "oldest") copy.sort((a, b) => a.date - b.date);
  if (mode === "unread") copy.sort((a, b) => Number(b.unread) - Number(a.unread) || b.date - a.date);
  if (mode === "sender")
    copy.sort((a, b) => (a.from.name ?? a.from.email).localeCompare(b.from.name ?? b.from.email) || b.date - a.date);
  return copy;
}

/** Conversations the next action applies to: checked ones, else the selected one. */
export function targetIds(): string[] {
  const { checked, selectedId, openId } = useMail.getState();
  if (checked.size) return [...checked];
  const id = openId ?? selectedId;
  return id ? [id] : [];
}
