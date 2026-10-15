import { create } from "zustand";
import { api, on } from "../lib/ipc";
import type { UpdateStatus } from "../lib/types";
import { useApp } from "./app";
import { useCompose } from "./compose";

interface UpdateStore {
  status: UpdateStatus | null;
  /** Shown when open drafts need a word before restarting. */
  confirmRestart: boolean;
  init: () => Promise<() => void>;
  check: () => Promise<void>;
  download: () => Promise<void>;
  restart: (confirmed?: boolean) => Promise<void>;
  setConfirm: (v: boolean) => void;
}

let announced: string | null = null;

export const useUpdate = create<UpdateStore>((set, get) => {
  const apply = (s: UpdateStatus) => {
    set({ status: s });
    // Tell the user once per version that it's ready.
    if (s.state === "ready" && s.version && announced !== s.version) {
      announced = s.version;
      useApp.getState().toast(`Vela ${s.version} is ready. Restart to install it.`, {
        kind: "success",
        duration: 12000,
        action: { label: "Restart", run: () => get().restart() },
      });
    }
  };

  return {
    status: null,
    confirmRestart: false,

    init: async () => {
      const un = on("update://status", apply);
      try {
        apply(await api.updateStatus());
      } catch {
        /* updater unavailable: leave status empty */
      }
      return () => {
        un.then((f) => f());
      };
    },

    check: async () => {
      try {
        apply(await api.checkForUpdate());
      } catch (e) {
        useApp.getState().error(e, "Couldn't check for updates.");
      }
    },

    download: async () => {
      try {
        apply(await api.downloadUpdate());
      } catch (e) {
        useApp.getState().error(e, "Couldn't download the update.");
      }
    },

    restart: async (confirmed = false) => {
      const composers = useCompose.getState().composers;
      if (composers.some((c) => c.sending)) {
        useApp.getState().toast("A message is still sending. Restart once it's sent.", { kind: "error" });
        return;
      }
      if (composers.length && !confirmed) {
        set({ confirmRestart: true });
        return;
      }
      set({ confirmRestart: false });
      try {
        await api.installUpdate();
      } catch (e) {
        useApp.getState().error(e, "Couldn't install the update.");
      }
    },

    setConfirm: (v) => set({ confirmRestart: v }),
  };
});
