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

describe("pending queue", () => {
  it("enqueue is idempotent — re-discovering ids never duplicates rows", () => {
    state.enqueuePending(["a", "b"]);
    state.enqueuePending(["a", "b"]); // same batch again (cursor re-read)
    const rows = state.listPending();
    expect(rows.map((r) => r.messageId).sort()).toEqual(["a", "b"]);
    expect(rows.every((r) => r.attempts === 0)).toBe(true);
  });

  it("empty enqueue is a no-op", () => {
    state.enqueuePending([]);
    expect(state.listPending()).toHaveLength(2);
  });

  it("bumping to the attempt cap abandons the row (excluded from the work list)", () => {
    for (let i = 1; i <= state.MAX_PENDING_ATTEMPTS; i++) {
      expect(state.bumpPendingAttempt("a")).toBe(i);
    }
    const rows = state.listPending();
    expect(rows.map((r) => r.messageId)).toEqual(["b"]);
  });

  it("bumping an unknown id is a safe no-op returning 0", () => {
    expect(state.bumpPendingAttempt("never-enqueued")).toBe(0);
  });

  it("resolvePending removes the row terminally", () => {
    state.resolvePending("b");
    expect(state.listPending()).toHaveLength(0);
    // Resolving again (or an abandoned row) is harmless.
    state.resolvePending("b");
    state.resolvePending("a");
    expect(state.listPending()).toHaveLength(0);
  });
});

describe("pruneOldState", () => {
  it("removes drafted/pending rows past the age cutoff, keeps recent ones", () => {
    const db = state.stateDb();
    const old = Date.now() - 120 * 86_400_000; // 120 days ago
    db.prepare(
      "INSERT INTO handled(messageId, createdAt) VALUES('ancient', ?), ('recent', ?)",
    ).run(old, Date.now());
    db.prepare(
      "INSERT INTO pending(messageId, discoveredAt, attempts) VALUES('stale-pending', ?, 5)",
    ).run(old);

    state.pruneOldState(90);

    expect(state.alreadyHandled("ancient")).toBe(false);
    expect(state.alreadyHandled("recent")).toBe(true);
    const pendingCount = db
      .prepare(
        "SELECT COUNT(*) AS n FROM pending WHERE messageId = 'stale-pending'",
      )
      .get() as { n: number };
    expect(pendingCount.n).toBe(0);
  });
});
