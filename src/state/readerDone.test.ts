import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  modifyThreads: vi.fn(async () => {}),
  trashThreads: vi.fn(async () => {}),
  snoozeThreads: vi.fn(async () => {}),
  broadcast: vi.fn(async () => {}),
  listThreads: vi.fn(async () => ({ threads: [], nextPageToken: null, resultSizeEstimate: 0 })),
  listLabels: vi.fn(async () => []),
}));

vi.mock("../lib/ipc", async (orig) => ({
  ...(await orig<typeof import("../lib/ipc")>()),
  api: { ...mocks, cachedThreads: async () => [], getThread: async () => ({}) },
  broadcast: mocks.broadcast,
}));

import { useApp } from "./app";
import { useMail } from "./mail";
import { handleReaderDone, revertReaderAction } from "./readerDone";

const account = (id: string) => ({ id, email: id, displayName: null, status: "ok" as const });

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({ accounts: [account("a@x.com"), account("b@x.com")], activeAccount: "a@x.com", toasts: [] });
  useMail.setState({ undo: null });
});

describe("revertReaderAction", () => {
  it("re-applies labels for a modify", async () => {
    await revertReaderAction("b@x.com", ["t1"], { kind: "modify", add: ["INBOX"], remove: ["SPAM"] });
    expect(mocks.modifyThreads).toHaveBeenCalledWith("b@x.com", ["t1"], ["INBOX"], ["SPAM"]);
  });

  it("restores from trash and unsnoozes", async () => {
    await revertReaderAction("a@x.com", ["t1", "t2"], { kind: "untrash" });
    expect(mocks.trashThreads).toHaveBeenCalledWith("a@x.com", ["t1", "t2"], true);
    await revertReaderAction("a@x.com", ["t1"], { kind: "unsnooze" });
    expect(mocks.snoozeThreads).toHaveBeenCalledWith("a@x.com", ["t1"], null);
  });
});

describe("handleReaderDone", () => {
  const done = { accountId: "b@x.com", threadIds: ["t1"], message: "Archived", undo: { kind: "modify" as const, add: ["INBOX"], remove: [] } };

  it("ignores accounts that aren't signed in", () => {
    handleReaderDone({ ...done, accountId: "ghost@x.com" });
    expect(useMail.getState().undo).toBeNull();
    expect(useApp.getState().toasts).toHaveLength(0);
  });

  it("offers Undo that reverts on the payload's account, not the active one", async () => {
    handleReaderDone(done);
    const toast = useApp.getState().toasts[0];
    expect(toast.message).toBe("Archived");
    expect(toast.action?.label).toBe("Undo");
    expect(useMail.getState().undo?.label).toBe("Archived");

    await useMail.getState().runUndo();
    expect(mocks.modifyThreads).toHaveBeenCalledWith("b@x.com", ["t1"], ["INBOX"], []);
    expect(mocks.modifyThreads).not.toHaveBeenCalledWith("a@x.com", expect.anything(), expect.anything(), expect.anything());
  });
});
