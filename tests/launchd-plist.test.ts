import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  agentEnv,
  LABEL,
  labelFor,
  plistPathFor,
  renderPlist,
  resolveCliPath,
} from "../src/agent/launchd.js";

describe("launchd plist rendering", () => {
  it("embeds the exact node and cli paths and the watch argument", () => {
    const xml = renderPlist("/opt/node/bin/node", "/repo/dist/cli.js");
    expect(xml).toContain(`<string>${LABEL}</string>`);
    expect(xml).toContain("<string>/opt/node/bin/node</string>");
    expect(xml).toContain("<string>/repo/dist/cli.js</string>");
    expect(xml).toContain("<string>watch</string>");
    expect(xml).toContain("watch.log");
    expect(xml).toContain("<key>KeepAlive</key>");
  });

  it("escapes XML-hostile characters in paths", () => {
    const xml = renderPlist("/weird & path/node", "/a<b>/cli.js");
    expect(xml).toContain("/weird &amp; path/node");
    expect(xml).toContain("/a&lt;b&gt;/cli.js");
  });

  it("renders NO EnvironmentVariables block for the default profile — byte-stability for the live daemon", () => {
    const xml = renderPlist("/opt/node/bin/node", "/repo/dist/cli.js");
    expect(xml).not.toContain("EnvironmentVariables");
    expect(xml).toBe(
      renderPlist("/opt/node/bin/node", "/repo/dist/cli.js", {}),
    );
  });

  it("embeds env entries as an EnvironmentVariables dict, XML-escaped", () => {
    const xml = renderPlist("/n", "/c", {
      INBOXMINDER_PROFILE: "acme",
      INBOXMINDER_DATA_DIR: "/tmp/a & b",
    });
    expect(xml).toContain("<key>EnvironmentVariables</key>");
    expect(xml).toContain("<key>INBOXMINDER_PROFILE</key>");
    expect(xml).toContain("<string>acme</string>");
    expect(xml).toContain("<string>/tmp/a &amp; b</string>");
  });

  it("resolves THIS repo's dist/cli.js from the src tree (tsx branch)", () => {
    // Regression pin for a chunk-split bug: the parent-dir walk
    // must land in this repo's dist, never a directory above the repo
    // (resolveCliPath once returned <parent-of-repo>/dist/cli.js when the
    // bundled module landed in a dist chunk).
    const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
    expect(resolveCliPath()).toBe(join(repoRoot, "dist", "cli.js"));
  });
});

describe("per-profile labels and env", () => {
  it("default profile keeps the exact historical label and plist path", () => {
    expect(labelFor(null)).toBe("com.inboxminder.agent");
    expect(plistPathFor(null)).toBe(
      join(homedir(), "Library", "LaunchAgents", "com.inboxminder.agent.plist"),
    );
  });

  it("named profiles get a prefix-stable label the app can glob", () => {
    expect(labelFor("acme")).toBe("com.inboxminder.agent.acme");
    expect(plistPathFor("acme")).toBe(
      join(
        homedir(),
        "Library",
        "LaunchAgents",
        "com.inboxminder.agent.acme.plist",
      ),
    );
  });

  it("agentEnv is empty for the default profile with no overrides", () => {
    expect(agentEnv({})).toEqual({});
  });

  it("agentEnv carries the profile and any base-dir overrides", () => {
    expect(
      agentEnv({
        INBOXMINDER_PROFILE: "acme",
        INBOXMINDER_DATA_DIR: "/tmp/base",
        HOME: "/Users/x",
      }),
    ).toEqual({
      INBOXMINDER_PROFILE: "acme",
      INBOXMINDER_DATA_DIR: "/tmp/base",
    });
  });

  it("this process's LABEL matches its profile derivation", () => {
    expect(LABEL).toBe(labelFor(process.env.INBOXMINDER_PROFILE || null));
  });
});
