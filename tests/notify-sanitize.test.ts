import { describe, expect, it } from "vitest";
import { profiledTitle, sanitizeNotification } from "../src/notify.js";

describe("sanitizeNotification", () => {
  it("collapses all whitespace runs (newlines included) to single spaces", () => {
    expect(sanitizeNotification("a\nb\r\n\tc   d")).toBe("a b c d");
  });

  it("trims and truncates to 120 chars", () => {
    expect(sanitizeNotification("  hi  ")).toBe("hi");
    const long = "x".repeat(300);
    expect(sanitizeNotification(long)).toHaveLength(120);
  });

  it("survives the osascript JSON.stringify composition round-trip", () => {
    const nasty = 'Re: "quoted" \\ backslash \n and newline';
    const clean = sanitizeNotification(nasty);
    // notify() embeds the value via JSON.stringify into an osascript arg;
    // parsing it back must yield the sanitized string unchanged.
    expect(JSON.parse(JSON.stringify(clean))).toBe(clean);
    expect(clean).toBe('Re: "quoted" \\ backslash and newline');
  });
});

describe("profiledTitle", () => {
  it("default profile leaves the title untouched", () => {
    expect(profiledTitle("InboxMinder", null)).toBe("InboxMinder");
  });

  it("named profiles get a suffix so notifications are attributable", () => {
    expect(profiledTitle("InboxMinder", "acme")).toBe("InboxMinder (acme)");
  });
});
