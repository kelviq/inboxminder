import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Point all state (sqlite) at a temp dir BEFORE loading the modules under test.
process.env.INBOXMINDER_DATA_DIR = mkdtempSync(
  join(tmpdir(), "inboxminder-test-"),
);

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
let state: typeof import("../src/db/state.js");
let cfg: import("../src/config/schema.js").Config;

beforeAll(async () => {
  ({ runWatchTick } = await import("../src/email/watcher.js"));
  state = await import("../src/db/state.js");
  const { ConfigSchema } = await import("../src/config/schema.js");
  cfg = ConfigSchema.parse({ email: { notifications: false } });
  state.setKV("gmail:selfEmail", SELF);
});

beforeEach(() => {
  pollMailHistory.mockReset().mockResolvedValue({ inboxIds: [], sentIds: [] });
  getMessage.mockReset();
  setThreadLabels.mockReset().mockResolvedValue(undefined);
  classifyReplyWorthiness.mockReset().mockResolvedValue({
    reply: false,
    confidence: "sure",
    reason: "scripted",
    category: "notification",
  });
});

function inboundMsg(overrides: Record<string, unknown> = {}) {
  return {
    id: "m1",
    threadId: "thread-1",
    from: "them@example.com",
    to: SELF,
    subject: "Hello",
    messageIdHeader: "<m1@example.com>",
    references: "",
    listUnsubscribe: false,
    bodyText: "hi",
    ...overrides,
  };
}

describe("durable pending queue in the tick", () => {
  it("a fetch failure keeps the id queued; the NEXT tick retries and handles it without rediscovery", async () => {
    // Tick 1: the message is discovered, but the fetch fails (Gmail 5xx).
    pollMailHistory.mockResolvedValue({ inboxIds: ["m-retry"], sentIds: [] });
    getMessage.mockRejectedValue(new Error("gmail 503"));

    await runWatchTick(cfg);

    expect(state.alreadyHandled("m-retry")).toBe(false);
    expect(state.listPending()).toEqual([
      { messageId: "m-retry", attempts: 1 },
    ]);

    // Tick 2: history returns NOTHING (the cursor moved past it at
    // discovery — this is the exact loss scenario). The queue must retry.
    pollMailHistory.mockResolvedValue({ inboxIds: [], sentIds: [] });
    getMessage.mockResolvedValue(inboundMsg({ id: "m-retry" }));

    await runWatchTick(cfg);

    expect(classifyReplyWorthiness).toHaveBeenCalledTimes(1);
    expect(state.alreadyHandled("m-retry")).toBe(true);
    expect(state.listPending()).toHaveLength(0);
  });

  it("skip-filtered messages resolve out of the queue instead of retrying forever", async () => {
    pollMailHistory.mockResolvedValue({ inboxIds: ["m-bounce"], sentIds: [] });
    getMessage.mockResolvedValue(
      inboundMsg({ id: "m-bounce", from: "mailer-daemon@example.com" }),
    );

    await runWatchTick(cfg);

    expect(classifyReplyWorthiness).not.toHaveBeenCalled();
    expect(state.listPending()).toHaveLength(0);
  });

  it("a message deleted between discovery and fetch resolves (gone is gone)", async () => {
    pollMailHistory.mockResolvedValue({ inboxIds: ["m-gone"], sentIds: [] });
    getMessage.mockResolvedValue(null);

    await runWatchTick(cfg);

    expect(state.listPending()).toHaveLength(0);
  });

  it("abandons after MAX_PENDING_ATTEMPTS and stops retrying", async () => {
    // First tick discovers the id; every later tick returns empty history —
    // retries must come from the queue alone.
    pollMailHistory.mockResolvedValueOnce({
      inboxIds: ["m-doom"],
      sentIds: [],
    });
    getMessage.mockRejectedValue(new Error("permanent boom"));

    for (let i = 0; i < state.MAX_PENDING_ATTEMPTS; i++) {
      await runWatchTick(cfg);
    }
    expect(state.listPending()).toHaveLength(0); // abandoned, not lost track of
    expect(state.alreadyHandled("m-doom")).toBe(false);

    // Further ticks never touch it again.
    getMessage.mockClear();
    await runWatchTick(cfg);
    expect(getMessage).not.toHaveBeenCalled();
  });

  it("with triage and labels both disabled, no classifier call is spent", async () => {
    const { ConfigSchema } = await import("../src/config/schema.js");
    const off = ConfigSchema.parse({
      email: { notifications: false },
      triage: { enabled: false },
      labels: { enabled: false },
    });
    pollMailHistory.mockResolvedValue({ inboxIds: ["m-off"], sentIds: [] });
    getMessage.mockResolvedValue(inboundMsg({ id: "m-off" }));

    await runWatchTick(off);

    expect(pollMailHistory).toHaveBeenCalledWith(false);
    expect(classifyReplyWorthiness).not.toHaveBeenCalled();
    expect(state.listPending()).toHaveLength(0);
  });
});
