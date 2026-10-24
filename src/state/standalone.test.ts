import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  modifyThreads: vi.fn(async () => {}),
  listThreads: vi.fn(async () => ({ threads: [], nextPageToken: null, resultSizeEstimate: 0 })),
  listLabels: vi.fn(async () => []),
  saveSettings: vi.fn(async (s: unknown) => s),
}));

vi.mock("../lib/ipc", async (orig) => ({
  ...(await orig<typeof import("../lib/ipc")>()),
  api: mocks,
  broadcast: vi.fn(async () => {}),
}));

import type { Settings, ThreadSummary } from "../lib/types";
import { useApp } from "./app";
import { useMail } from "./mail";

const thread = (id: string): ThreadSummary => ({
  id,
  historyId: "",
  subject: "s",
  snippet: "",
  senders: [],
  from: { name: null, email: "a@b.c" },
  to: [],
  date: 1,
  unread: false,
  starred: false,
  important: false,
  hasAttachments: false,
  hasDraft: false,
  messageCount: 1,
  labelIds: ["INBOX"],
  snoozedUntil: null,
});

beforeEach(() => {
  vi.clearAllMocks();
  useApp.setState({ activeAccount: "a@x.com", toasts: [] });
});

describe("standalone mode (pop-out windows)", () => {
  it("keeps the email in the list after it leaves the view", async () => {
    useMail.setState({ standalone: true, view: { kind: "label", labelId: "INBOX" }, threads: [thread("t1")], selectedId: "t1", openId: "t1", checked: new Set() });
    await useMail.getState().archive(["t1"]);
    const [t] = useMail.getState().threads;
    expect(t.id).toBe("t1");
    expect(t.labelIds).not.toContain("INBOX");
    expect(useMail.getState().openId).toBe("t1");
    expect(mocks.modifyThreads).toHaveBeenCalledWith("a@x.com", ["t1"], [], ["INBOX"]);
  });

  it("still removes it in the main window", async () => {
    useMail.setState({ standalone: false, view: { kind: "label", labelId: "INBOX" }, threads: [thread("t1")], selectedId: "t1", openId: null, checked: new Set() });
    await useMail.getState().archive(["t1"]);
    expect(useMail.getState().threads).toHaveLength(0);
  });
});

describe("settings from another window", () => {
  const remote = { theme: "light" } as Settings;

  it("replaces local settings when nothing is pending", () => {
    useApp.setState({ settings: { theme: "dark" } as Settings });
    useApp.getState().receiveSettings(remote);
    expect(useApp.getState().settings?.theme).toBe("light");
  });

  it("is ignored while this window has its own save pending", () => {
    useApp.setState({ settings: { theme: "dark" } as Settings });
    useApp.getState().updateSettings({ density: "compact" });
    useApp.getState().receiveSettings(remote);
    expect(useApp.getState().settings?.theme).toBe("dark");
  });
});
