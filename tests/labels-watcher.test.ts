import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Point all state (sqlite) at a temp dir BEFORE loading the modules.
process.env.INBOXMINDER_DATA_DIR = mkdtempSync(
  join(tmpdir(), "inboxminder-test-"),
);

const SELF = "founder@example.com";

const pollMailHistory = vi.hoisted(() => vi.fn());
const getMessage = vi.hoisted(() => vi.fn());
const setThreadLabels = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("../src/email/gmail.js", () => ({
  pollMailHistory,
  getMessage,
  setThreadLabels,
}));

const notify = vi.hoisted(() => vi.fn());
vi.mock("../src/notify.js", () => ({ notify }));
const classifyReplyWorthiness = vi.hoisted(() => vi.fn());
vi.mock("../src/engine/classify.js", () => ({ classifyReplyWorthiness }));

let runWatchTick: typeof import("../src/email/watcher.js").runWatchTick;
let state: typeof import("../src/db/state.js");
let ConfigSchema: typeof import("../src/config/schema.js").ConfigSchema;

beforeAll(async () => {
  ({ runWatchTick } = await import("../src/email/watcher.js"));
  state = await import("../src/db/state.js");
  ({ ConfigSchema } = await import("../src/config/schema.js"));
  state.setKV("gmail:selfEmail", SELF);
});

const labelsCfg = (enabled: boolean) =>
  ConfigSchema.parse({
    email: { notifications: false },
    // Isolate the [labels] feature: triage off so only Pending/Resolved
    // projections can produce label calls in these tests.
    triage: { enabled: false },
    labels: { enabled },
  });

const inbound = (id: string, threadId: string) => ({
  id,
  threadId,
  from: "them@example.com",
  to: SELF,
  subject: `Subj ${id}`,
  messageIdHeader: `<${id}@x>`,
  references: "",
  listUnsubscribe: false,
  bodyText: "please reply",
});

const outbound = (id: string, threadId: string) => ({
  ...inbound(id, threadId),
  from: SELF,
  to: "them@example.com",
  references: "<root@x>",
});

beforeEach(() => {
  pollMailHistory.mockReset().mockResolvedValue({ inboxIds: [], sentIds: [] });
  getMessage.mockReset();
  setThreadLabels.mockReset().mockResolvedValue(undefined);
  classifyReplyWorthiness.mockReset().mockResolvedValue({
    reply: true,
    confidence: "sure",
    reason: "scripted",
  });
});

describe("[labels] config", () => {
  it("defaults: enabled with the InboxMinder/* names", () => {
    expect(ConfigSchema.parse({}).labels).toEqual({
      enabled: true,
      pending: "InboxMinder/Pending",
      resolved: "InboxMinder/Resolved",
    });
  });

  it("rejects empty label names", () => {
    expect(() => ConfigSchema.parse({ labels: { pending: "" } })).toThrow();
  });
});

describe("thread-state label projection", () => {
  it("reply-worthy inbound -> Pending added, Resolved removed", async () => {
    pollMailHistory.mockResolvedValue({ inboxIds: ["m1"], sentIds: [] });
    getMessage.mockResolvedValue(inbound("m1", "t-label-1"));
    await runWatchTick(labelsCfg(true));
    expect(setThreadLabels).toHaveBeenCalledWith(
      "t-label-1",
      ["InboxMinder/Pending"],
      ["InboxMinder/Resolved"],
    );
  });

  it("own outbound reply -> Resolved added, Pending removed", async () => {
    pollMailHistory.mockResolvedValue({ inboxIds: [], sentIds: ["s1"] });
    getMessage.mockResolvedValue(outbound("s1", "t-label-2"));
    await runWatchTick(labelsCfg(true));
    expect(setThreadLabels).toHaveBeenCalledWith(
      "t-label-2",
      ["InboxMinder/Resolved"],
      ["InboxMinder/Pending"],
    );
  });

  it("labels enabled alone turns on sent observation", async () => {
    await runWatchTick(labelsCfg(true));
    expect(pollMailHistory).toHaveBeenCalledWith(true);
  });

  it("labels + triage disabled: no label calls, sent observation stays off", async () => {
    pollMailHistory.mockResolvedValue({ inboxIds: ["m2"], sentIds: [] });
    getMessage.mockResolvedValue(inbound("m2", "t-label-3"));
    await runWatchTick(labelsCfg(false));
    expect(setThreadLabels).not.toHaveBeenCalled();
    expect(pollMailHistory).toHaveBeenCalledWith(false);
  });

  it("label failure never costs the tick or the handled record", async () => {
    setThreadLabels.mockRejectedValue(new Error("insufficient scope"));
    pollMailHistory.mockResolvedValue({ inboxIds: ["m3"], sentIds: [] });
    getMessage.mockResolvedValue(inbound("m3", "t-label-4"));
    await expect(runWatchTick(labelsCfg(true))).resolves.toBe(true);
    expect(state.alreadyHandled("m3")).toBe(true);
  });
});

describe("provider capability presence", () => {
  it("gmail provider exposes setThreadLabels", async () => {
    const { mailProvider } = await import("../src/email/provider.js");
    expect(mailProvider(ConfigSchema.parse({})).setThreadLabels).toBeTypeOf(
      "function",
    );
  });
});
