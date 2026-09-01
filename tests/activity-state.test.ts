import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

// Point all state (sqlite) at a temp dir BEFORE loading the module under test.
process.env.INBOXMINDER_DATA_DIR = mkdtempSync(
  join(tmpdir(), "inboxminder-test-"),
);

let state: typeof import("../src/db/state.js");

beforeAll(async () => {
  state = await import("../src/db/state.js");
});

describe("activity feed", () => {
  it("records an event with full field passthrough", () => {
    state.recordActivity("reauth", {
      subject: "Re: pricing question",
      threadId: "thread-a",
      messageId: "<m1@example.com>",
      detail: "extra",
    });
    const [row] = state.recentActivity(1);
    expect(row).toMatchObject({
      kind: "reauth",
      subject: "Re: pricing question",
      threadId: "thread-a",
      messageId: "<m1@example.com>",
      detail: "extra",
    });
    expect(row.createdAt).toBeGreaterThan(0);
  });

  it("omitted optional fields land as NULL", () => {
    state.recordActivity("reauth", {});
    const [row] = state.recentActivity(1);
    expect(row).toMatchObject({
      kind: "reauth",
      subject: null,
      threadId: null,
      messageId: null,
      detail: null,
    });
  });

  it("returns newest first and honors the limit", () => {
    state.recordActivity("reauth", { subject: "older" });
    state.recordActivity("reauth", { subject: "newer" });
    const rows = state.recentActivity(2);
    expect(rows).toHaveLength(2);
    expect(rows[0].subject).toBe("newer");
    expect(rows[1].subject).toBe("older");
  });

  it("prunes to the 200-row cap, dropping the oldest", () => {
    for (let i = 0; i < 210; i++) {
      state.recordActivity("reauth", { subject: `bulk-${i}` });
    }
    const rows = state.recentActivity(500);
    expect(rows).toHaveLength(200);
    expect(rows[0].subject).toBe("bulk-209"); // newest kept
    expect(rows.some((r) => r.subject === "bulk-9")).toBe(false);
    expect(rows[rows.length - 1].subject).toBe("bulk-10");
  });
});

describe("pause + auth-failure flags", () => {
  it("watch pause round-trips through kv", () => {
    expect(state.isWatchPaused()).toBe(false);
    state.setWatchPaused(true);
    expect(state.isWatchPaused()).toBe(true);
    state.setWatchPaused(false);
    expect(state.isWatchPaused()).toBe(false);
  });

  it("auth-failed flag sets, reads, and clears", () => {
    expect(state.authFailedAt()).toBeNull();
    state.setAuthFailed();
    const at = state.authFailedAt();
    expect(at).toBeGreaterThan(0);
    state.clearAuthFailed();
    expect(state.authFailedAt()).toBeNull();
    // Clearing again is a harmless no-op.
    state.clearAuthFailed();
    expect(state.authFailedAt()).toBeNull();
  });
});

describe("known-correspondent ledger", () => {
  it("records lowercased and answers membership", () => {
    state.recordCorrespondents(["Alice@Example.COM"]);
    expect(state.hasCorrespondent("alice@example.com")).toBe(true);
    expect(state.hasCorrespondent("ALICE@EXAMPLE.COM")).toBe(true);
    expect(state.hasCorrespondent("bob@example.com")).toBe(false);
    expect(state.hasCorrespondent("")).toBe(false);
  });
});
