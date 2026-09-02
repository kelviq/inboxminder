import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

// Point all state (sqlite + status.json) at a temp dir BEFORE loading modules.
const dataDir = mkdtempSync(join(tmpdir(), "inboxminder-test-"));
process.env.INBOXMINDER_DATA_DIR = dataDir;

let statusFile: typeof import("../src/agent/status-file.js");
let state: typeof import("../src/db/state.js");
let cfg: import("../src/config/schema.js").Config;

beforeAll(async () => {
  statusFile = await import("../src/agent/status-file.js");
  state = await import("../src/db/state.js");
  cfg = (await import("../src/config/schema.js")).ConfigSchema.parse({});
});

const statusPath = () => join(dataDir, "status.json");

describe("buildStatusJson (pure projection)", () => {
  const baseInputs = () => ({
    pid: 4242,
    tickAt: 1_724_700_000_000,
    pollIntervalSec: 45,
    paused: false,
    reauthNeeded: false,
    selfEmail: "me@example.com",
    profile: null as string | null,
    updateAvailable: null as string | null,
    activity: [] as import("../src/db/state.js").ActivityRow[],
  });

  it("emits the v1 contract shape with staleAfterMs computed at 5 ticks", () => {
    const json = statusFile.buildStatusJson(baseInputs());
    expect(json).toEqual({
      v: 1,
      pid: 4242,
      tickAt: 1_724_700_000_000,
      staleAfterMs: 5 * 45 * 1000,
      paused: false,
      reauthNeeded: false,
      selfEmail: "me@example.com",
      profile: null,
      updateAvailable: null,
      activity: [],
    });
  });

  it("carries updateAvailable additively — v stays 1", () => {
    const json = statusFile.buildStatusJson({
      ...baseInputs(),
      updateAvailable: "1.2.3",
    });
    expect(json.v).toBe(1);
    expect(json.updateAvailable).toBe("1.2.3");
  });

  it("carries the profile name additively — v stays 1", () => {
    const json = statusFile.buildStatusJson({
      ...baseInputs(),
      profile: "acme",
    });
    expect(json.v).toBe(1);
    expect(json.profile).toBe("acme");
  });

  it("maps activity rows (createdAt -> at) and caps at 50", () => {
    const rows = Array.from({ length: 60 }, (_, i) => ({
      id: 60 - i,
      kind: "reauth" as const,
      subject: `s${i}`,
      threadId: `t${i}`,
      messageId: `<m${i}>`,
      detail: null,
      createdAt: 1000 + i,
    }));
    const json = statusFile.buildStatusJson({
      ...baseInputs(),
      activity: rows,
    });
    expect(json.activity).toHaveLength(50);
    expect(json.activity[0]).toEqual({
      kind: "reauth",
      subject: "s0",
      threadId: "t0",
      messageId: "<m0>",
      detail: null,
      at: 1000,
    });
    expect(json.activity[0]).not.toHaveProperty("createdAt");
    expect(json.activity[0]).not.toHaveProperty("id");
  });
});

describe("writeStatusFile", () => {
  it("writes valid JSON reflecting live kv + activity state", () => {
    state.setKV("heartbeat:watch", "1724700000123");
    state.setKV("gmail:selfEmail", "me@example.com");
    state.setWatchPaused(true);
    state.setAuthFailed();
    state.recordActivity("reauth", {
      subject: "Hello",
      threadId: "t-1",
      messageId: "<m-1@example.com>",
    });

    statusFile.writeStatusFile(cfg);

    const json = JSON.parse(readFileSync(statusPath(), "utf8"));
    expect(json).toMatchObject({
      v: 1,
      pid: process.pid,
      tickAt: 1724700000123,
      staleAfterMs: 5 * cfg.email.pollIntervalSec * 1000,
      paused: true,
      reauthNeeded: true,
      selfEmail: "me@example.com",
    });
    expect(json.activity[0]).toMatchObject({
      kind: "reauth",
      subject: "Hello",
      threadId: "t-1",
      messageId: "<m-1@example.com>",
    });
  });

  it("reflects resume + auth clear on the next write", () => {
    state.setWatchPaused(false);
    state.clearAuthFailed();
    statusFile.writeStatusFile(cfg);
    const json = JSON.parse(readFileSync(statusPath(), "utf8"));
    expect(json.paused).toBe(false);
    expect(json.reauthNeeded).toBe(false);
  });

  it("never throws upward when the write path is broken", () => {
    // Occupy the target path with a non-empty directory so the atomic
    // rename fails.
    rmSync(statusPath(), { force: true });
    mkdirSync(join(statusPath(), "blocker"), { recursive: true });
    expect(() => statusFile.writeStatusFile(cfg)).not.toThrow();
    rmSync(statusPath(), { recursive: true, force: true });
    // And a normal write works again afterwards.
    statusFile.writeStatusFile(cfg);
    expect(JSON.parse(readFileSync(statusPath(), "utf8")).v).toBe(1);
  });
});
