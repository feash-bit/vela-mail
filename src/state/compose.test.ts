import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ sendMessage: vi.fn(async () => "sent") }));

vi.mock("../lib/ipc", async (orig) => ({
  ...(await orig<typeof import("../lib/ipc")>()),
  api: mocks,
}));

import { newSeed } from "../lib/compose";
import type { DraftInput } from "../lib/types";
import { useApp } from "./app";
import { flushPendingSends, registerSaver, saveAllDrafts, unregisterSaver, useCompose } from "./compose";

const draft = { subject: "hi" } as DraftInput;

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({ settings: { undoSendSeconds: 30 } as never, toasts: [] });
  useCompose.setState({ composers: [] });
});

describe("closing with pending sends", () => {
  it("flushPendingSends sends waiting messages immediately", async () => {
    const key = useCompose.getState().open("a@x.com", newSeed(), "inline");
    useCompose.getState().send(key, newSeed(), draft);
    expect(mocks.sendMessage).not.toHaveBeenCalled();

    await flushPendingSends();
    expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
    expect(mocks.sendMessage).toHaveBeenCalledWith("a@x.com", draft);
    expect(useCompose.getState().composers).toHaveLength(0);

    // Nothing is left to send twice.
    await flushPendingSends();
    expect(mocks.sendMessage).toHaveBeenCalledTimes(1);
  });

  it("an undone send is not flushed", async () => {
    const key = useCompose.getState().open("a@x.com", newSeed(), "inline");
    useCompose.getState().send(key, newSeed(), draft);
    useApp.getState().toasts[0].action!.run();
    await flushPendingSends();
    expect(mocks.sendMessage).not.toHaveBeenCalled();
  });
});

describe("saveAllDrafts", () => {
  it("saves every registered composer except ones being sent", async () => {
    const a = useCompose.getState().open("a@x.com", newSeed(), "inline");
    const b = useCompose.getState().open("a@x.com", newSeed(), "sheet");
    const saveA = vi.fn(async () => {});
    const saveB = vi.fn(async () => {});
    registerSaver(a, saveA);
    registerSaver(b, saveB);
    useCompose.getState().send(b, newSeed(), draft);

    await saveAllDrafts();
    expect(saveA).toHaveBeenCalledTimes(1);
    expect(saveB).not.toHaveBeenCalled();

    unregisterSaver(a);
    await saveAllDrafts();
    expect(saveA).toHaveBeenCalledTimes(1);
    useCompose.getState().close(b);
    unregisterSaver(b);
  });

  it("keeps going when one save fails", async () => {
    const a = useCompose.getState().open("a@x.com", newSeed(), "inline");
    const b = useCompose.getState().open("a@x.com", newSeed(), "sheet");
    const saveB = vi.fn(async () => {});
    registerSaver(a, async () => {
      throw new Error("offline");
    });
    registerSaver(b, saveB);
    await expect(saveAllDrafts()).resolves.toBeUndefined();
    expect(saveB).toHaveBeenCalled();
    unregisterSaver(a);
    unregisterSaver(b);
  });
});
