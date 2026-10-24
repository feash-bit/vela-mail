import { create } from "zustand";
import type { ComposeSeed } from "../lib/compose";
import { api } from "../lib/ipc";
import type { DraftInput } from "../lib/types";
import { useApp } from "./app";

export interface ComposerInstance {
  key: string;
  accountId: string;
  seed: ComposeSeed;
  /** "sheet": focused writing window; "inline": under the conversation in the reader. */
  placement: "sheet" | "inline";
  minimized: boolean;
  /** Waiting out the undo-send delay (hidden, not yet sent). */
  sending: boolean;
}

interface ComposeStore {
  composers: ComposerInstance[];
  open: (accountId: string, seed: ComposeSeed, placement?: "sheet" | "inline") => string;
  close: (key: string) => void;
  update: (key: string, seed: Partial<ComposeSeed>) => void;
  setMinimized: (key: string, v: boolean) => void;
  toSheet: (key: string) => void;
  send: (key: string, snapshot: ComposeSeed, draft: DraftInput) => void;
}

let n = 0;
/** Sends waiting out the undo delay. The draft is kept so a closing window can send them straight away. */
const pending = new Map<string, { timer: ReturnType<typeof setTimeout>; draft: DraftInput }>();
/** Sends already on their way to Gmail. */
const delivering = new Set<Promise<void>>();
/** Each open composer's "save my draft now" function (see `saveAllDrafts`). */
const savers = new Map<string, () => Promise<void>>();

const patch = (key: string, p: Partial<ComposerInstance>) =>
  useCompose.setState((s) => ({ composers: s.composers.map((c) => (c.key === key ? { ...c, ...p } : c)) }));

async function deliver(key: string, draft: DraftInput) {
  pending.delete(key);
  const c = useCompose.getState().composers.find((x) => x.key === key);
  if (!c) return;
  const app = useApp.getState();
  try {
    await api.sendMessage(c.accountId, draft);
    useCompose.getState().close(key);
    app.toast("Message sent", { kind: "success" });
  } catch (e) {
    // Bring the message back so nothing is lost.
    patch(key, { sending: false, minimized: false });
    app.error(e, "Couldn't send the message. It's still open so you can try again.");
  }
}

function deliverNow(key: string, draft: DraftInput) {
  const p = deliver(key, draft).finally(() => delivering.delete(p));
  delivering.add(p);
  return p;
}

function cancelPending(key: string) {
  const p = pending.get(key);
  if (p) clearTimeout(p.timer);
  pending.delete(key);
}

/** Send everything still waiting out the undo delay now, and wait for sends already under way (used before a window closes). */
export async function flushPendingSends(): Promise<void> {
  const all = [...pending.entries()];
  all.forEach(([, p]) => clearTimeout(p.timer));
  await Promise.all([...all.map(([key, p]) => deliverNow(key, p.draft)), ...delivering]);
}

export const registerSaver = (key: string, fn: () => Promise<void>) => void savers.set(key, fn);
export const unregisterSaver = (key: string) => void savers.delete(key);

/** Save every open composer's draft. Messages already being sent are skipped: saving would resurrect a draft. */
export async function saveAllDrafts(): Promise<void> {
  const sending = new Set(useCompose.getState().composers.filter((c) => c.sending).map((c) => c.key));
  await Promise.allSettled([...savers].filter(([key]) => !sending.has(key)).map(([, save]) => save()));
}

export const useCompose = create<ComposeStore>((set, get) => ({
  composers: [],
  open: (accountId, seed, placement = "sheet") => {
    if (placement === "inline" && seed.threadId) {
      const existing = get().composers.find((c) => c.placement === "inline" && c.seed.threadId === seed.threadId && !c.sending);
      if (existing) {
        // Switching reply → reply-all keeps what was already typed.
        set({ composers: get().composers.map((c) => (c.key === existing.key ? { ...c, seed: { ...seed, body: c.seed.body || seed.body, draftId: c.seed.draftId }, minimized: false } : c)) });
        return existing.key;
      }
    }
    const key = `c${++n}`;
    set({
      composers: [
        ...get().composers.map((c) => (c.placement === "sheet" && placement === "sheet" ? { ...c, minimized: true } : c)),
        { key, accountId, seed, placement, minimized: false, sending: false },
      ],
    });
    return key;
  },
  close: (key) => {
    cancelPending(key);
    set({ composers: get().composers.filter((c) => c.key !== key) });
  },
  update: (key, seed) => set({ composers: get().composers.map((c) => (c.key === key ? { ...c, seed: { ...c.seed, ...seed } } : c)) }),
  setMinimized: (key, v) => {
    const target = get().composers.find((c) => c.key === key);
    set({
      composers: get().composers.map((c) => {
        if (c.key === key) return { ...c, minimized: v };
        // Only one expanded sheet at a time.
        if (!v && target?.placement === "sheet" && c.placement === "sheet") return { ...c, minimized: true };
        return c;
      }),
    });
  },
  toSheet: (key) =>
    set({
      composers: get().composers.map((c) =>
        c.key === key ? { ...c, placement: "sheet", minimized: false } : c.placement === "sheet" ? { ...c, minimized: true } : c,
      ),
    }),
  send: (key, snapshot, draft) => {
    patch(key, { seed: snapshot, sending: true });
    const delay = (useApp.getState().settings?.undoSendSeconds ?? 5) * 1000;
    if (delay <= 0) {
      deliverNow(key, draft);
      return;
    }
    pending.set(key, { timer: setTimeout(() => deliverNow(key, draft), delay), draft });
    useApp.getState().toast("Sending…", {
      duration: delay,
      action: {
        label: "Undo",
        run: () => {
          cancelPending(key);
          patch(key, { sending: false, minimized: false });
        },
      },
    });
  },
}));

export const hasExpandedSheet = () => useCompose.getState().composers.some((c) => c.placement === "sheet" && !c.minimized && !c.sending);
