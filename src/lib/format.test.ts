import { describe, expect, it } from "vitest";
import { fileSize, hueFor, initials, isValidEmail, listDate, parseAddressInput, sendersLine } from "./format";

describe("format", () => {
  it("formats list dates relative to now", () => {
    const now = new Date(2026, 9, 15, 16, 0).getTime();
    expect(listDate(new Date(2026, 9, 14, 9, 0).getTime(), now)).toBe("Yesterday");
    expect(listDate(new Date(2025, 0, 3).getTime(), now)).toMatch(/2025/);
    expect(listDate(0, now)).toBe("");
  });

  it("parses typed addresses", () => {
    expect(parseAddressInput('"Lee, Ann" <ann@x.com>')).toEqual({ name: "Lee, Ann", email: "ann@x.com" });
    expect(parseAddressInput("bob@x.com,")).toEqual({ name: null, email: "bob@x.com" });
    expect(parseAddressInput("  ")).toBeNull();
  });

  it("validates addresses strictly", () => {
    expect(isValidEmail("ann@example.com")).toBe(true);
    expect(isValidEmail("ann@localhost")).toBe(false);
    expect(isValidEmail("a b@x.com")).toBe(false);
    expect(isValidEmail("a@x.com\r\nBcc: z@y.com")).toBe(false);
  });

  it("builds initials, sizes and stable hues", () => {
    expect(initials("Maya Chen")).toBe("MC");
    expect(initials("forge")).toBe("FO");
    expect(fileSize(2_480_000)).toBe("2.4 MB");
    expect(hueFor("a@x.com")).toBe(hueFor("a@x.com"));
    expect(sendersLine(["Ann", "Bob", "Cy", "Di", "me"], 5)).toBe("Ann, …, Di, me  5");
  });
});
