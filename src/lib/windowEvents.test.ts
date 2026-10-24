import { describe, expect, it } from "vitest";
import { isSettings, parseReaderDone, parseThreadChanged } from "./windowEvents";

describe("window event validation", () => {
  it("accepts a well-formed thread-changed event", () => {
    const e = { source: "reader-0123", accountId: "me@example.com", threadIds: ["18c2f0a1b2c3d4e5"] };
    expect(parseThreadChanged(e)).toEqual(e);
  });

  it("rejects malformed thread-changed events", () => {
    expect(parseThreadChanged(null)).toBeNull();
    expect(parseThreadChanged("x")).toBeNull();
    expect(parseThreadChanged({ source: 1, accountId: "a@b.c", threadIds: [] })).toBeNull();
    expect(parseThreadChanged({ source: "main", accountId: "", threadIds: [] })).toBeNull();
    expect(parseThreadChanged({ source: "main", accountId: "a@b.c", threadIds: "abc" })).toBeNull();
    expect(parseThreadChanged({ source: "main", accountId: "a@b.c", threadIds: ["ok", 5] })).toBeNull();
    expect(parseThreadChanged({ source: "main", accountId: "a@b.c", threadIds: ["../x"] })).toBeNull();
    expect(parseThreadChanged({ source: "main", accountId: "a@b.c", threadIds: Array(201).fill("a") })).toBeNull();
  });

  const done = { accountId: "me@example.com", threadIds: ["abc123"], message: "Archived", undo: { kind: "modify", add: ["INBOX"], remove: [] } };

  it("accepts every kind of undo", () => {
    expect(parseReaderDone(done)).toEqual(done);
    expect(parseReaderDone({ ...done, undo: { kind: "untrash" } })?.undo).toEqual({ kind: "untrash" });
    expect(parseReaderDone({ ...done, undo: { kind: "unsnooze", extra: 1 } })?.undo).toEqual({ kind: "unsnooze" });
  });

  it("rejects malformed reader-done events", () => {
    expect(parseReaderDone(undefined)).toBeNull();
    expect(parseReaderDone({ ...done, undo: { kind: "delete-everything" } })).toBeNull();
    expect(parseReaderDone({ ...done, undo: { kind: "modify", add: "INBOX", remove: [] } })).toBeNull();
    expect(parseReaderDone({ ...done, undo: { kind: "modify", add: [3], remove: [] } })).toBeNull();
    expect(parseReaderDone({ ...done, undo: null })).toBeNull();
    expect(parseReaderDone({ ...done, threadIds: [] })).toBeNull();
    expect(parseReaderDone({ ...done, threadIds: ["a b"] })).toBeNull();
    expect(parseReaderDone({ ...done, message: 5 })).toBeNull();
    expect(parseReaderDone({ ...done, message: "x".repeat(201) })).toBeNull();
    expect(parseReaderDone({ ...done, accountId: 7 })).toBeNull();
  });

  it("checks the settings shape", () => {
    const ok = {
      theme: "dark",
      accent: "#8b7bff",
      density: "comfortable",
      readerLayout: "split",
      markReadOnOpen: true,
      blockRemoteImages: true,
      customTitleBar: true,
      trustedSenders: ["a@b.c"],
      shortcuts: {},
    };
    expect(isSettings(ok)).toBe(true);
    expect(isSettings({ ...ok, trustedSenders: [1] })).toBe(false);
    expect(isSettings({ ...ok, shortcuts: [] })).toBe(false);
    expect(isSettings({ ...ok, theme: undefined })).toBe(false);
    expect(isSettings(null)).toBe(false);
  });
});
