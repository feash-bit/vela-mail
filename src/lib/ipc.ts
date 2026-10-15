// Typed bridge to the Rust backend. Every call goes through `call`, which
// normalises errors into { code, message }.
//
// In a dev-only demo build (VITE_DEMO=1) mail commands are served from local
// sample data so the interface can be developed without a Google account.
// Production builds never include the demo module.

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type {
  Account,
  AppErr,
  AppInfo,
  Contact,
  DraftContent,
  DraftInput,
  Identity,
  Label,
  LocalFile,
  MailChanged,
  SavedDraft,
  Settings,
  SyncState,
  ThreadDetail,
  ThreadPage,
  ThreadSummary,
  View,
} from "./types";

type Handler = (cmd: string, args: Record<string, unknown>) => Promise<unknown>;

let demo: Handler | null = null;
export const isDemo = import.meta.env.VITE_DEMO === "1";

export async function initIpc() {
  if (isDemo) {
    const mod = await import("../demo/demo");
    demo = mod.handle;
  }
}

export function toAppErr(e: unknown): AppErr {
  if (e && typeof e === "object" && "code" in e && "message" in e) return e as AppErr;
  return { code: "internal", message: typeof e === "string" ? e : "Something went wrong." };
}

async function call<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  try {
    if (demo && cmd !== "window_ready") return (await demo(cmd, args)) as T;
    return await invoke<T>(cmd, args);
  } catch (e) {
    throw toAppErr(e);
  }
}

export const api = {
  windowReady: () => call<void>("window_ready"),
  appInfo: () => call<AppInfo>("app_info"),
  getSettings: () => call<Settings>("get_settings"),
  saveSettings: (settings: Settings) => call<Settings>("save_settings", { settings }),
  importClientConfig: () => call<boolean>("import_client_config"),
  takePendingMailto: () => call<string | null>("take_pending_mailto"),
  openExternal: (url: string) => call<void>("open_external", { url }),

  addAccount: (loginHint?: string) => call<Account>("add_account", { loginHint: loginHint ?? null }),
  cancelSignIn: () => call<void>("cancel_sign_in"),
  removeAccount: (accountId: string) => call<Account[]>("remove_account", { accountId }),
  getIdentity: (accountId: string) => call<Identity>("get_identity", { accountId }),

  listLabels: (accountId: string) => call<Label[]>("list_labels", { accountId }),
  listThreads: (accountId: string, view: View, pageToken: string | null, filter: string | null) =>
    call<ThreadPage>("list_threads", { accountId, view, pageToken, filter }),
  cachedThreads: (accountId: string, view: View) => call<ThreadSummary[]>("cached_threads", { accountId, view }),
  getThread: (accountId: string, threadId: string, allowRemote: boolean) =>
    call<ThreadDetail>("get_thread", { accountId, threadId, allowRemote }),
  suggestContacts: (accountId: string, query: string) => call<Contact[]>("suggest_contacts", { accountId, query }),
  syncNow: () => call<void>("sync_now"),

  modifyThreads: (accountId: string, threadIds: string[], add: string[], remove: string[]) =>
    call<void>("modify_threads", { accountId, threadIds, add, remove }),
  trashThreads: (accountId: string, threadIds: string[], restore = false) =>
    call<void>("trash_threads", { accountId, threadIds, restore }),
  snoozeThreads: (accountId: string, threadIds: string[], until: number | null) =>
    call<void>("snooze_threads", { accountId, threadIds, until }),

  saveDraft: (accountId: string, draft: DraftInput) => call<SavedDraft>("save_draft", { accountId, draft }),
  sendMessage: (accountId: string, draft: DraftInput) => call<string>("send_message", { accountId, draft }),
  deleteDraft: (accountId: string, draftId: string) => call<void>("delete_draft", { accountId, draftId }),
  openDraft: (accountId: string, threadId: string) => call<DraftContent>("open_draft", { accountId, threadId }),

  pickAttachments: () => call<LocalFile[]>("pick_attachments"),
  releaseAttachment: (token: string) => call<void>("release_attachment", { token }),
  saveAttachment: (accountId: string, messageId: string, attachmentId: string, filename: string) =>
    call<boolean>("save_attachment", { accountId, messageId, attachmentId, filename }),
  attachmentPreview: (accountId: string, messageId: string, attachmentId: string, mimeType: string) =>
    call<string>("attachment_preview", { accountId, messageId, attachmentId, mimeType }),
  openAttachment: (accountId: string, messageId: string, attachmentId: string, filename: string) =>
    call<void>("open_attachment", { accountId, messageId, attachmentId, filename }),
};

export interface Events {
  "mail://changed": MailChanged;
  "sync://state": SyncState;
  "account://status": { accountId: string; status: Account["status"] };
  "accounts://changed": Account[];
  "app://open-thread": { accountId: string; threadId: string };
  "app://mailto": string;
  "files://hover": boolean;
  "files://dropped": { files: LocalFile[]; errors: string[] };
}

export function on<K extends keyof Events>(event: K, fn: (payload: Events[K]) => void): Promise<UnlistenFn> {
  if (isDemo && typeof window !== "undefined" && !("__TAURI_INTERNALS__" in window)) return Promise.resolve(() => {});
  return listen<Events[K]>(event, (e) => fn(e.payload));
}

export const inTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
