import { create } from "zustand";
import { api, toAppErr } from "../lib/ipc";
import { isReaderWindow } from "../lib/window";
import type { Account, AppErr, AppInfo, Identity, Label, Settings, SyncState } from "../lib/types";

export interface Toast {
  id: number;
  kind: "info" | "success" | "error";
  message: string;
  action?: { label: string; run: () => void };
  duration: number;
}

export type Dialog = null | "settings" | "shortcuts" | "palette";
export type SettingsSection = "appearance" | "accounts" | "mail" | "notifications" | "privacy" | "shortcuts" | "startup" | "updates";

interface AppStore {
  info: AppInfo | null;
  settings: Settings | null;
  accounts: Account[];
  activeAccount: string | null;
  labels: Record<string, Label[]>;
  identities: Record<string, Identity>;
  sync: Record<string, SyncState>;
  toasts: Toast[];
  dialog: Dialog;
  settingsSection: SettingsSection;
  dropHover: boolean;
  online: boolean;

  boot: () => Promise<void>;
  refreshInfo: () => Promise<void>;
  updateSettings: (patch: Partial<Settings>) => void;
  receiveSettings: (s: Settings) => void;
  setActiveAccount: (id: string) => void;
  setAccounts: (a: Account[]) => void;
  setAccountStatus: (id: string, status: Account["status"]) => void;
  loadLabels: (accountId?: string) => Promise<void>;
  loadIdentity: (accountId: string) => Promise<Identity | null>;
  setSync: (s: SyncState) => void;
  toast: (message: string, opts?: Partial<Omit<Toast, "id" | "message">>) => number;
  error: (e: unknown, fallback?: string) => void;
  dismissToast: (id: number) => void;
  openDialog: (d: Dialog, section?: SettingsSection) => void;
  setDropHover: (v: boolean) => void;
  setOnline: (v: boolean) => void;
}

let toastId = 0;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let saveInFlight = 0;

/** This window is about to write (or is writing) its own settings, which will be broadcast next. */
const savePending = () => saveTimer !== null || saveInFlight > 0;

export const useApp = create<AppStore>((set, get) => ({
  info: null,
  settings: null,
  accounts: [],
  activeAccount: null,
  labels: {},
  identities: {},
  sync: {},
  toasts: [],
  dialog: null,
  settingsSection: "appearance",
  dropHover: false,
  online: typeof navigator !== "undefined" ? navigator.onLine : true,

  boot: async () => {
    const [info, settings] = await Promise.all([api.appInfo(), api.getSettings()]);
    const active =
      info.accounts.find((a) => a.id === settings.activeAccount)?.id ?? info.accounts[0]?.id ?? null;
    set({ info, settings, accounts: info.accounts, activeAccount: active });
  },

  refreshInfo: async () => {
    const info = await api.appInfo();
    const { activeAccount } = get();
    set({
      info,
      accounts: info.accounts,
      activeAccount: info.accounts.find((a) => a.id === activeAccount)?.id ?? info.accounts[0]?.id ?? null,
    });
  },

  updateSettings: (patch) => {
    const cur = get().settings;
    if (!cur) return;
    const next = { ...cur, ...patch };
    set({ settings: next });
    // Pop-out windows never write settings: the main window owns them.
    if (isReaderWindow()) return;
    // Debounced write; the backend validates and clamps values.
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      saveInFlight++;
      api
        .saveSettings(get().settings!)
        .catch((e) => get().error(e, "Couldn't save settings."))
        .finally(() => saveInFlight--);
    }, 250);
  },

  // Settings changed in another window. Skipped while our own write is pending,
  // because it carries newer values and will be broadcast in turn.
  receiveSettings: (settings) => {
    if (!savePending()) set({ settings });
  },

  setActiveAccount: (id) => {
    set({ activeAccount: id });
    get().updateSettings({ activeAccount: id });
  },

  setAccounts: (accounts) => {
    const { activeAccount } = get();
    set({
      accounts,
      activeAccount: accounts.find((a) => a.id === activeAccount)?.id ?? accounts[0]?.id ?? null,
    });
  },

  setAccountStatus: (id, status) =>
    set((s) => ({ accounts: s.accounts.map((a) => (a.id === id ? { ...a, status } : a)) })),

  loadLabels: async (accountId) => {
    const id = accountId ?? get().activeAccount;
    if (!id) return;
    try {
      const labels = await api.listLabels(id);
      set((s) => ({ labels: { ...s.labels, [id]: labels } }));
    } catch (e) {
      const err = toAppErr(e);
      if (err.code !== "offline" && err.code !== "auth_expired") get().error(err, "Couldn't load labels.");
    }
  },

  loadIdentity: async (accountId) => {
    const cached = get().identities[accountId];
    if (cached) return cached;
    try {
      const id = await api.getIdentity(accountId);
      set((s) => ({ identities: { ...s.identities, [accountId]: id } }));
      return id;
    } catch {
      return null;
    }
  },

  setSync: (s) => set((st) => ({ sync: { ...st.sync, [s.accountId]: s } })),

  toast: (message, opts = {}) => {
    const id = ++toastId;
    const t: Toast = { id, message, kind: opts.kind ?? "info", action: opts.action, duration: opts.duration ?? (opts.action ? 6000 : 3500) };
    set((s) => ({ toasts: [...s.toasts.slice(-3), t] }));
    return id;
  },

  error: (e, fallback = "Something went wrong.") => {
    const err: AppErr = toAppErr(e);
    if (err.code === "cancelled") return;
    get().toast(err.message || fallback, { kind: "error", duration: 6000 });
  },

  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  openDialog: (dialog, section) => set((s) => ({ dialog, settingsSection: section ?? s.settingsSection })),
  setDropHover: (dropHover) => set({ dropHover }),
  setOnline: (online) => set({ online }),
}));

export const useSettings = () => useApp((s) => s.settings!);

export function labelName(accountId: string | null, id: string): string | undefined {
  if (!accountId) return undefined;
  return useApp.getState().labels[accountId]?.find((l) => l.id === id)?.name;
}
