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
// The classifier is the triage vehicle — scripted per test, no LLM.
const classifyReplyWorthiness = vi.hoisted(() => vi.fn());
vi.mock("../src/engine/classify.js", () => ({ classifyReplyWorthiness }));

let watcher: typeof import("../src/email/watcher.js");
let state: typeof import("../src/db/state.js");
let ConfigSchema: typeof import("../src/config/schema.js").ConfigSchema;

beforeAll(async () => {
  watcher = await import("../src/email/watcher.js");
  state = await import("../src/db/state.js");
  ({ ConfigSchema } = await import("../src/config/schema.js"));
  state.setKV("gmail:selfEmail", SELF);
});

const cfgWith = (over: Record<string, unknown> = {}) =>
  ConfigSchema.parse({ email: { notifications: false }, ...over });

const inbound = (
  id: string,
  threadId: string,
  over: Partial<import("../src/email/gmail.js").InboundMessage> = {},
) => ({
  id,
  threadId,
  from: "them@example.com",
  to: SELF,
  subject: `Subj ${id}`,
  messageIdHeader: `<${id}@x>`,
  references: "",
  listUnsubscribe: false,
  bodyText: "hello",
  ...over,
});

const verdict = (v: Record<string, unknown>) =>
  classifyReplyWorthiness.mockResolvedValue({
    reply: false,
    confidence: "sure",
    reason: "scripted",
    ...v,
  });

beforeEach(() => {
  pollMailHistory.mockReset().mockResolvedValue({ inboxIds: [], sentIds: [] });
  getMessage.mockReset();
  setThreadLabels.mockReset().mockResolvedValue(undefined);
  classifyReplyWorthiness.mockReset();
  notify.mockReset();
});

describe("[triage] config", () => {
  it("defaults: enabled, archive nothing, no hint (triage IS the product)", () => {
    expect(ConfigSchema.parse({}).triage).toEqual({
      enabled: true,
      archive: [],
      coldOutreachHint: "",
      labels: {
        newsletter: "InboxMinder/Newsletter",
        notification: "InboxMinder/Notification",
        marketing: "InboxMinder/Marketing",
        "cold-outreach": "InboxMinder/Cold Outreach",
        fyi: "InboxMinder/FYI",
        important: "InboxMinder/Important",
      },
    });
  });

  it("archive accepts only the fixed category set", () => {
    expect(
      ConfigSchema.parse({ triage: { archive: ["newsletter", "marketing"] } })
        .triage.archive,
    ).toEqual(["newsletter", "marketing"]);
    expect(() =>
      ConfigSchema.parse({ triage: { archive: ["reply"] } }),
    ).toThrow();
    expect(() =>
      ConfigSchema.parse({ triage: { archive: ["important"] } }),
    ).toThrow();
  });

  it("custom label names flow through to Gmail", async () => {
    pollMailHistory.mockResolvedValue({ inboxIds: ["twc"], sentIds: [] });
    getMessage.mockResolvedValue(inbound("twc", "t-twc"));
    verdict({ category: "newsletter" });
    await watcher.runWatchTick(
      cfgWith({ triage: { labels: { newsletter: "News/Weekly" } } }),
    );
    expect(setThreadLabels).toHaveBeenCalledWith("t-twc", ["News/Weekly"], []);
  });
});

describe("category labeling", () => {
  it("non-reply mail gets its category label, no archive by default", async () => {
    pollMailHistory.mockResolvedValue({ inboxIds: ["tw1"], sentIds: [] });
    getMessage.mockResolvedValue(inbound("tw1", "t-tw1"));
    verdict({ category: "notification" });
    await watcher.runWatchTick(cfgWith());
    expect(setThreadLabels).toHaveBeenCalledWith(
      "t-tw1",
      ["InboxMinder/Notification"],
      [],
    );
    // Marked handled so crash-window re-reads don't re-classify.
    expect(state.alreadyHandled("tw1")).toBe(true);
  });

  it("opted-in category archives atomically with its label", async () => {
    pollMailHistory.mockResolvedValue({ inboxIds: ["tw2"], sentIds: [] });
    getMessage.mockResolvedValue(inbound("tw2", "t-tw2"));
    verdict({ category: "marketing" });
    await watcher.runWatchTick(
      cfgWith({ triage: { enabled: true, archive: ["marketing"] } }),
    );
    expect(setThreadLabels).toHaveBeenCalledWith(
      "t-tw2",
      ["InboxMinder/Marketing"],
      ["INBOX"],
    );
  });

  it("non-opted category never archives even when others are opted in", async () => {
    pollMailHistory.mockResolvedValue({ inboxIds: ["tw3"], sentIds: [] });
    getMessage.mockResolvedValue(inbound("tw3", "t-tw3"));
    verdict({ category: "fyi" });
    await watcher.runWatchTick(
      cfgWith({ triage: { enabled: true, archive: ["marketing"] } }),
    );
    expect(setThreadLabels).toHaveBeenCalledWith(
      "t-tw3",
      ["InboxMinder/FYI"],
      [],
    );
  });

  it("reply-worthy mail is never categorized or archived — it gets Pending", async () => {
    pollMailHistory.mockResolvedValue({ inboxIds: ["tw4"], sentIds: [] });
    getMessage.mockResolvedValue(inbound("tw4", "t-tw4"));
    verdict({ reply: true, category: "newsletter" }); // hostile combo — reply wins
    await watcher.runWatchTick(
      cfgWith({ triage: { enabled: true, archive: ["newsletter"] } }),
    );
    expect(setThreadLabels).toHaveBeenCalledTimes(1);
    expect(setThreadLabels).toHaveBeenCalledWith(
      "t-tw4",
      ["InboxMinder/Pending"],
      ["InboxMinder/Resolved"],
    );
  });

  it("important reply-worthy mail gets Important + a notification", async () => {
    pollMailHistory.mockResolvedValue({ inboxIds: ["tw5"], sentIds: [] });
    getMessage.mockResolvedValue(inbound("tw5", "t-tw5"));
    verdict({ reply: true, important: true });
    await watcher.runWatchTick(
      ConfigSchema.parse({ email: { notifications: true } }),
    );
    expect(setThreadLabels).toHaveBeenCalledWith(
      "t-tw5",
      ["InboxMinder/Important"],
      [],
    );
    expect(notify).toHaveBeenCalledWith("InboxMinder", "Important — Subj tw5");
  });

  it("not-important reply-worthy mail never notifies", async () => {
    pollMailHistory.mockResolvedValue({ inboxIds: ["tw5b"], sentIds: [] });
    getMessage.mockResolvedValue(inbound("tw5b", "t-tw5b"));
    verdict({ reply: true });
    await watcher.runWatchTick(
      ConfigSchema.parse({ email: { notifications: true } }),
    );
    expect(notify).not.toHaveBeenCalled();
  });

  it("label failure never costs the tick", async () => {
    setThreadLabels.mockRejectedValue(new Error("insufficient scope"));
    pollMailHistory.mockResolvedValue({ inboxIds: ["tw6"], sentIds: [] });
    getMessage.mockResolvedValue(inbound("tw6", "t-tw6"));
    verdict({ category: "newsletter" });
    await expect(watcher.runWatchTick(cfgWith())).resolves.toBe(true);
  });
});

describe("known-correspondent guard", () => {
  it("a stranger's cold outreach is labeled", async () => {
    pollMailHistory.mockResolvedValue({ inboxIds: ["tw10"], sentIds: [] });
    getMessage.mockResolvedValue(
      inbound("tw10", "t-tw10", { from: "stranger@pitch.example" }),
    );
    verdict({ category: "cold-outreach" });
    await watcher.runWatchTick(cfgWith());
    expect(setThreadLabels).toHaveBeenCalledWith(
      "t-tw10",
      ["InboxMinder/Cold Outreach"],
      [],
    );
  });

  it("anyone in the correspondents ledger can never be Cold Outreach", async () => {
    state.recordCorrespondents(["friend@example.com"]);
    pollMailHistory.mockResolvedValue({ inboxIds: ["tw11"], sentIds: [] });
    getMessage.mockResolvedValue(
      inbound("tw11", "t-tw11", { from: "Friend <friend@example.com>" }),
    );
    verdict({ category: "cold-outreach" });
    await watcher.runWatchTick(cfgWith());
    expect(setThreadLabels).not.toHaveBeenCalled();
  });

  it("mid-conversation mail (References) can never be Cold Outreach", async () => {
    pollMailHistory.mockResolvedValue({ inboxIds: ["tw12"], sentIds: [] });
    getMessage.mockResolvedValue(
      inbound("tw12", "t-tw12", { references: "<root@x>" }),
    );
    verdict({ category: "cold-outreach" });
    await watcher.runWatchTick(cfgWith());
    expect(setThreadLabels).not.toHaveBeenCalled();
  });

  it("the guard only suppresses cold-outreach, not other categories", async () => {
    state.recordCorrespondents(["colleague@example.com"]);
    pollMailHistory.mockResolvedValue({ inboxIds: ["tw14"], sentIds: [] });
    getMessage.mockResolvedValue(
      inbound("tw14", "t-tw14", { from: "colleague@example.com" }),
    );
    verdict({ category: "fyi" });
    await watcher.runWatchTick(cfgWith());
    expect(setThreadLabels).toHaveBeenCalledWith(
      "t-tw14",
      ["InboxMinder/FYI"],
      [],
    );
  });
});

describe("sent observation + correspondent harvest", () => {
  it("defaults turn on sent observation (triage + labels both on)", async () => {
    await watcher.runWatchTick(cfgWith());
    expect(pollMailHistory).toHaveBeenCalledWith(true);
  });

  it("observed outbound recipients join the ledger", async () => {
    pollMailHistory.mockResolvedValue({ inboxIds: [], sentIds: ["tws1"] });
    getMessage.mockResolvedValue(
      inbound("tws1", "t-tws1", {
        from: SELF,
        to: 'Alice <alice@example.com>, "Bob, B." <bob@example.com>',
      }),
    );
    await watcher.runWatchTick(cfgWith());
    expect(state.hasCorrespondent("alice@example.com")).toBe(true);
    expect(state.hasCorrespondent("bob@example.com")).toBe(true);
    expect(state.hasCorrespondent("nobody@example.com")).toBe(false);
  });

  it("self-to-self notification loops never join the ledger", async () => {
    pollMailHistory.mockResolvedValue({ inboxIds: [], sentIds: ["tws2"] });
    getMessage.mockResolvedValue(
      inbound("tws2", "t-tws2", { from: SELF, to: SELF }),
    );
    await watcher.runWatchTick(cfgWith());
    expect(state.hasCorrespondent(SELF)).toBe(false);
  });
});
