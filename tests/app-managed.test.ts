import { describe, expect, it } from "vitest";
import {
  isAppManaged,
  reauthActionText,
  updateActionText,
} from "../src/agent/managed.js";

describe("isAppManaged (plan 053; wording branches on the install channel)", () => {
  it("true for the bundled runtime inside the app", () => {
    expect(
      isAppManaged(
        "/Applications/InboxMinder.app/Contents/Resources/runtime/bin/node",
      ),
    ).toBe(true);
  });

  it("false for npm/nvm/homebrew installs", () => {
    for (const p of [
      "/usr/local/bin/node",
      "/opt/homebrew/bin/node",
      "/Users/x/.nvm/versions/node/v22.23.1/bin/node",
    ]) {
      expect(isAppManaged(p)).toBe(false);
    }
  });

  it("false for an unrelated app bundle path", () => {
    expect(isAppManaged("/Applications/Other.app/Contents/MacOS/node")).toBe(
      false,
    );
  });
});

describe("notification wording", () => {
  it("app-managed users are never told to run a command", () => {
    expect(reauthActionText(true)).not.toMatch(/run:|inboxminder /);
    expect(updateActionText("0.10.1", true)).not.toMatch(/npm|run:/);
    expect(updateActionText("0.10.1", true)).toContain("0.10.1");
  });

  it("npm users keep the exact commands", () => {
    expect(reauthActionText(false)).toContain("inboxminder auth");
    expect(updateActionText("0.10.1", false)).toContain(
      "npm update -g inboxminder",
    );
  });
});
