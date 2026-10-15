import { describe, expect, it } from "vitest";
import { alternatives, conflicts, createMatcher, eventToKey, keyCaps, resolveBindings } from "./shortcuts";

const ev = (key: string, mods: Partial<Record<"ctrlKey" | "metaKey" | "altKey" | "shiftKey", boolean>> = {}) => ({
  key,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

describe("shortcuts", () => {
  it("normalises events", () => {
    expect(eventToKey(ev("K", { ctrlKey: true, shiftKey: true }))).toBe("mod+shift+k");
    expect(eventToKey(ev("?", { shiftKey: true }))).toBe("?");
    expect(eventToKey(ev("#", { shiftKey: true }))).toBe("#");
    expect(eventToKey(ev("ArrowDown"))).toBe("arrowdown");
    expect(eventToKey(ev(",", { ctrlKey: true }))).toBe("mod+,");
  });

  it("keeps mod+comma intact when splitting alternatives", () => {
    expect(alternatives("mod+,")).toEqual(["mod+,"]);
    expect(alternatives("j, arrowdown")).toEqual(["j", "arrowdown"]);
  });

  it("has no conflicting defaults", () => {
    expect([...conflicts({}).keys()]).toEqual([]);
  });

  it("detects conflicts from overrides", () => {
    expect(conflicts({ archive: "s" }).get("s")).toEqual(["archive", "star"]);
  });

  it("matches sequences and single keys", () => {
    const m = createMatcher(() => resolveBindings({}));
    expect(m("g")).toBe("pending");
    expect(m("i")).toBe("goInbox");
    expect(m("e")).toBe("archive");
    expect(m("delete")).toBe("trash");
    expect(m("mod+,")).toBe("settings");
  });

  it("formats key caps", () => {
    expect(keyCaps("mod+shift+k")).toEqual([["Ctrl", "Shift", "K"]]);
    expect(keyCaps("g i")).toEqual([["G"], ["I"]]);
  });
});
