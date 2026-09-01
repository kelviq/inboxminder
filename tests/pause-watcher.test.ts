import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Point all state (sqlite) at a temp dir BEFORE loading the modules under test.
const dataDir = mkdtempSync(join(tmpdir(), "inboxminder-test-"));
process.env.INBOXMINDER_DATA_DIR = dataDir;

const SELF = "founder@example.com";

// --- mocks -------------------------------------------------------------
const pollMailHistory = vi.hoisted(() => vi.fn());
const getMessage = vi.hoisted(() => vi.fn());
const setThreadLabels = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("../src/email/gmail.js", () => ({
  pollMailHistory,
  getMessage,
  setThreadLabels,
}));

const classifyReplyWorthiness = vi.hoisted(() => vi.fn());
vi.mock("../src/engine/classify.js", () => ({ classifyReplyWorthiness }));

const notify = vi.hoisted(() => vi.fn());
vi.mock("../src/notify.js", () => ({ notify }));

let runWatchTick: typeof import("../src/email/watcher.js").runWatchTick;
let statusFile: typeof import("../src/agent/status-file.js");
let state: typeof import("../src/db/state.js");
let cfg: import("../src/config/schema.js").Config;

beforeAll(async () => {
  ({ runWatchTick } = await import("../src/email/watcher.js"));
  statusFile = await import("../src/agent/status-file.js");
  state = await import("../src/db/state.js");
  const { ConfigSchema } = await import("../src/config/schema.js");
  cfg = ConfigSchema.parse({ email: { notifications: false } });
  state.setKV("gmail:selfEmail", SELF);
});

beforeEach(() => {
  pollMailHistory.mockReset().mockResolvedValue({ inboxIds: [], sentIds: [] });
  getMessage.mockReset();
  classifyReplyWorthiness.mockReset().mockResolvedValue({
    reply: false,
    confidence: "sure",
    reason: "scripted",
    category: "notification",
  });
  state.setWatchPaused(false);
});

describe("pause gating", () => {
  it("paused: runWatchTick returns false and never polls Gmail", async () => {
    state.setWatchPaused(true);
    const ran = await runWatchTick(cfg);
    expect(ran).toBe(false);
    expect(pollMailHistory).not.toHaveBeenCalled();
  });

  it("paused: status.json is still written, and reports paused", () => {
    state.setWatchPaused(true);
    statusFile.writeStatusFile(cfg);
    const json = JSON.parse(readFileSync(join(dataDir, "status.json"), "utf8"));
    expect(json.paused).toBe(true);
  });

  it("resumed: runWatchTick returns true and polls again", async () => {
    const ran = await runWatchTick(cfg);
    expect(ran).toBe(true);
    expect(pollMailHistory).toHaveBeenCalledTimes(1);
  });
});
