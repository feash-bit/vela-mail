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
const timers = new Map<string, ReturnType<typeof setTimeout>>();

export const useCompose = create<ComposeStore>((set, get) => {
  const patch = (key: string, p: Partial<ComposerInstance>) =>
    set({ composers: get().composers.map((c) => (c.key === key ? { ...c, ...p } : c)) });

  async function deliver(key: string, draft: DraftInput) {
    timers.delete(key);
    const c = get().composers.find((x) => x.key === key);
    if (!c) return;
    const app = useApp.getState();
    try {
      await api.sendMessage(c.accountId, draft);
      get().close(key);
      app.toast("Message sent", { kind: "success" });
    } catch (e) {
      // Bring the message back so nothing is lost.
      patch(key, { sending: false, minimized: false });
      app.error(e, "Couldn't send the message. It's still open so you can try again.");
    }
  }

  return {
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
      const t = timers.get(key);
      if (t) clearTimeout(t);
      timers.delete(key);
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
        deliver(key, draft);
        return;
      }
      timers.set(
        key,
        setTimeout(() => deliver(key, draft), delay),
      );
      useApp.getState().toast("Sending…", {
        duration: delay,
        action: {
          label: "Undo",
          run: () => {
            const t = timers.get(key);
            if (t) clearTimeout(t);
            timers.delete(key);
            patch(key, { sending: false, minimized: false });
          },
        },
      });
    },
  };
});

export const hasExpandedSheet = () => useCompose.getState().composers.some((c) => c.placement === "sheet" && !c.minimized && !c.sending);
