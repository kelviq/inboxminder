import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// Point all state (sqlite) at a temp dir BEFORE loading the modules.
process.env.INBOXMINDER_DATA_DIR = mkdtempSync(
  join(tmpdir(), "inboxminder-test-"),
);

const notify = vi.hoisted(() => vi.fn());
vi.mock("../src/notify.js", () => ({ notify }));

let uc: typeof import("../src/update-check.js");
let state: typeof import("../src/db/state.js");
let VERSION: string;
let cfg: import("../src/config/schema.js").Config;

beforeAll(async () => {
  uc = await import("../src/update-check.js");
  state = await import("../src/db/state.js");
  ({ VERSION } = await import("../src/version.js"));
  cfg = (await import("../src/config/schema.js")).ConfigSchema.parse({});
});

afterEach(() => {
  vi.unstubAllGlobals();
  notify.mockReset();
  state.setKV("updateCheck:lastAt", "");
  state.setKV("updateCheck:available", "");
});

const release = (tag: string, status = 200) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      status,
      ok: status === 200,
      headers: new Map([["etag", 'W/"x"']]) as unknown as Headers,
      json: async () => ({ tag_name: tag }),
    })),
  );

describe("version kernels", () => {
  it("VERSION matches package.json (release discipline pin)", () => {
    const pkg = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    );
    expect(VERSION).toBe(pkg.version);
  });

  it("parses tags with and without the v prefix", () => {
    expect(uc.parseVersion("v1.2.3")).toEqual([1, 2, 3]);
    expect(uc.parseVersion("0.10.0")).toEqual([0, 10, 0]);
    expect(uc.parseVersion("nightly")).toBeNull();
  });

  it("compares numerically, not lexically", () => {
    expect(uc.isNewerVersion("0.10.0", "0.9.1")).toBe(true);
    expect(uc.isNewerVersion("0.9.1", "0.9.1")).toBe(false);
    expect(uc.isNewerVersion("0.9.0", "0.9.1")).toBe(false);
    expect(uc.isNewerVersion("garbage", "0.9.1")).toBe(false);
  });
});

describe("maybeCheckForUpdate", () => {
  it("notifies once per newer version and records availability", async () => {
    release("v99.0.0");
    await uc.maybeCheckForUpdate(cfg);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(uc.updateAvailable()).toBe("99.0.0");
    // Second interval, same version: recorded but not re-notified.
    state.setKV("updateCheck:lastAt", "");
    await uc.maybeCheckForUpdate(cfg);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("throttles to one request per interval", async () => {
    release("v99.0.1");
    await uc.maybeCheckForUpdate(cfg);
    await uc.maybeCheckForUpdate(cfg);
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });

  it("updateCheck=false makes zero network calls", async () => {
    release("v99.0.2");
    const off = {
      ...cfg,
      email: { ...cfg.email, updateCheck: false },
    };
    await uc.maybeCheckForUpdate(off);
    expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  });

  it("a network failure costs nothing and never throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("offline");
      }),
    );
    await expect(uc.maybeCheckForUpdate(cfg)).resolves.toBeUndefined();
    expect(uc.updateAvailable()).toBeNull();
  });

  it("an equal-or-older release reports no update", async () => {
    release(`v${VERSION}`);
    await uc.maybeCheckForUpdate(cfg);
    expect(uc.updateAvailable()).toBeNull();
    expect(notify).not.toHaveBeenCalled();
  });
});
