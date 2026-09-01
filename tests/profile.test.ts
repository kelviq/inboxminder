import { describe, expect, it } from "vitest";
import {
  assertValidProfileName,
  normalizeProfileArgv,
  profileName,
} from "../src/config/profile.js";

describe("profile name validation", () => {
  it("accepts plain lowercase names", () => {
    for (const name of ["acme", "a", "acme-support", "p2", "x".repeat(32)]) {
      expect(() => assertValidProfileName(name)).not.toThrow();
    }
  });

  it("rejects names that would be unsafe in paths, labels, or services", () => {
    for (const name of [
      "Acme",
      "a.b",
      "a b",
      "-lead",
      "",
      "x".repeat(33),
      "../escape",
      "a/b",
    ]) {
      expect(() => assertValidProfileName(name)).toThrow(/profile name/i);
    }
  });

  it('reserves "default" — one spelling of the live instance', () => {
    expect(() => assertValidProfileName("default")).toThrow(/reserved/);
  });
});

describe("normalizeProfileArgv", () => {
  it("normalizes --profile <name> into the env", () => {
    const env: NodeJS.ProcessEnv = {};
    normalizeProfileArgv(["node", "cli.js", "--profile", "acme", "watch"], env);
    expect(env.INBOXMINDER_PROFILE).toBe("acme");
  });

  it("normalizes --profile=<name>", () => {
    const env: NodeJS.ProcessEnv = {};
    normalizeProfileArgv(["node", "cli.js", "--profile=acme"], env);
    expect(env.INBOXMINDER_PROFILE).toBe("acme");
  });

  it("flag wins over a pre-set env var", () => {
    const env: NodeJS.ProcessEnv = { INBOXMINDER_PROFILE: "old" };
    normalizeProfileArgv(["node", "cli.js", "--profile", "acme"], env);
    expect(env.INBOXMINDER_PROFILE).toBe("acme");
  });

  it("leaves a valid env-only profile in place (the launchd path)", () => {
    const env: NodeJS.ProcessEnv = { INBOXMINDER_PROFILE: "acme" };
    normalizeProfileArgv(["node", "cli.js", "watch"], env);
    expect(env.INBOXMINDER_PROFILE).toBe("acme");
  });

  it("throws on a missing or invalid flag value", () => {
    expect(() =>
      normalizeProfileArgv(["node", "cli.js", "--profile"], {}),
    ).toThrow(/requires a name/);
    expect(() =>
      normalizeProfileArgv(["node", "cli.js", "--profile", "Bad.Name"], {}),
    ).toThrow(/profile name/i);
  });

  it("throws on a garbage env var even without a flag — a mangled plist must fail loudly", () => {
    expect(() =>
      normalizeProfileArgv(["node", "cli.js"], { INBOXMINDER_PROFILE: "../x" }),
    ).toThrow(/profile name/i);
  });
});

describe("profileName", () => {
  it("is null for the default profile", () => {
    expect(profileName({})).toBeNull();
    expect(profileName({ INBOXMINDER_PROFILE: "" })).toBeNull();
  });

  it("returns a valid name and validates on every read", () => {
    expect(profileName({ INBOXMINDER_PROFILE: "acme" })).toBe("acme");
    expect(() => profileName({ INBOXMINDER_PROFILE: "NOPE" })).toThrow(
      /profile name/i,
    );
  });
});
