import { join } from "node:path";
import Database from "better-sqlite3";
import { DATA_DIR, ensureDirs } from "../config/load.js";
import { log } from "../log.js";

let db: Database.Database | null = null;

export function stateDb(): Database.Database {
  if (db) return db;
  ensureDirs();
  db = new Database(join(DATA_DIR, "state.db"));
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS handled (messageId TEXT PRIMARY KEY, createdAt INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS pending (
      messageId    TEXT PRIMARY KEY,
      discoveredAt INTEGER NOT NULL,
      attempts     INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS correspondents (
      address    TEXT PRIMARY KEY,   -- lowercased email address the user has written TO
      lastSeenAt INTEGER NOT NULL    -- (known-correspondent guard)
    );
    CREATE TABLE IF NOT EXISTS activity (
      id        INTEGER PRIMARY KEY AUTOINCREMENT,
      kind      TEXT NOT NULL,          -- reauth
      subject   TEXT,                   -- email subject — NEVER bodies
      threadId  TEXT,
      messageId TEXT,
      detail    TEXT,
      createdAt INTEGER NOT NULL
    );
  `);
  return db;
}

export function getKV(key: string): string | null {
  const row = stateDb()
    .prepare("SELECT value FROM kv WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setKV(key: string, value: string): void {
  stateDb()
    .prepare(
      "INSERT INTO kv(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .run(key, value);
}

/** Has this message already been classified/labeled (crash-window dedup)? */
export function alreadyHandled(messageId: string): boolean {
  return !!stateDb()
    .prepare("SELECT 1 FROM handled WHERE messageId = ?")
    .get(messageId);
}

export function markHandled(messageId: string): void {
  stateDb()
    .prepare("INSERT OR IGNORE INTO handled(messageId, createdAt) VALUES(?, ?)")
    .run(messageId, Date.now());
}

// --- Pending queue -----------------------------------------------------------
// Durable buffer between discovery and triage. The Gmail history cursor
// advances at discovery time, so a message id that fails anywhere downstream
// (fetch, classify — or a crash mid-batch) would otherwise be lost forever:
// it never reappears in a future history page. Ids sit here until handled/
// skipped (resolvePending) or abandoned after MAX_PENDING_ATTEMPTS.

export const MAX_PENDING_ATTEMPTS = 5;

/** Record discovered ids durably — idempotent, one transaction. */
export function enqueuePending(ids: string[]): void {
  if (ids.length === 0) return;
  const db = stateDb();
  const insert = db.prepare(
    "INSERT OR IGNORE INTO pending(messageId, discoveredAt) VALUES(?, ?)",
  );
  const now = Date.now();
  db.transaction((list: string[]) => {
    for (const id of list) insert.run(id, now);
  })(ids);
}

/** Oldest-first work list; rows at the attempt cap are abandoned (excluded). */
export function listPending(
  maxAttempts = MAX_PENDING_ATTEMPTS,
): { messageId: string; attempts: number }[] {
  return stateDb()
    .prepare(
      "SELECT messageId, attempts FROM pending WHERE attempts < ? ORDER BY discoveredAt",
    )
    .all(maxAttempts) as { messageId: string; attempts: number }[];
}

/** A processing attempt failed — returns the new attempt count. */
export function bumpPendingAttempt(id: string): number {
  const db = stateDb();
  db.prepare(
    "UPDATE pending SET attempts = attempts + 1 WHERE messageId = ?",
  ).run(id);
  const row = db
    .prepare("SELECT attempts FROM pending WHERE messageId = ?")
    .get(id) as { attempts: number } | undefined;
  return row?.attempts ?? 0;
}

/** The message reached a terminal outcome (handled, skipped, or gone). */
export function resolvePending(id: string): void {
  stateDb().prepare("DELETE FROM pending WHERE messageId = ?").run(id);
}

/**
 * Startup pruning: handled/pending rows are dedup and retry state, not an
 * archive — 90 days is far beyond any crash-replay or retry window they
 * guard, and without pruning both grow forever. The correspondents ledger
 * is deliberately NOT pruned: a correspondent stays known.
 */
export function pruneOldState(maxAgeDays = 90): void {
  const cutoff = Date.now() - maxAgeDays * 86_400_000;
  const db = stateDb();
  db.prepare("DELETE FROM handled WHERE createdAt < ?").run(cutoff);
  db.prepare("DELETE FROM pending WHERE discoveredAt < ?").run(cutoff);
}

// --- Known-correspondent ledger ----------------------------------------------
// Addresses the user has been observed writing TO — harvested from the
// watcher's sent-mail observation. The Cold Outreach guard: anyone in this
// ledger can never be labeled Cold Outreach.

/** Record observed outbound recipients — idempotent, one transaction. */
export function recordCorrespondents(addresses: string[]): void {
  if (addresses.length === 0) return;
  const db = stateDb();
  const upsert = db.prepare(
    "INSERT INTO correspondents(address, lastSeenAt) VALUES(?, ?) ON CONFLICT(address) DO UPDATE SET lastSeenAt = excluded.lastSeenAt",
  );
  const now = Date.now();
  db.transaction((list: string[]) => {
    for (const a of list) upsert.run(a.toLowerCase(), now);
  })(addresses);
}

export function hasCorrespondent(address: string): boolean {
  if (!address) return false;
  return !!stateDb()
    .prepare("SELECT 1 FROM correspondents WHERE address = ?")
    .get(address.toLowerCase());
}

// --- Activity feed -----------------------------------------------------------
// A persisted, capped feed for the status surface (status.json). NOT an
// audit log: triage decisions are diagnostics and stay in watch.log; the
// cap is deliberate. Same privacy budget as notifications — subjects only,
// never bodies.

export type ActivityKind = "reauth";

export interface ActivityRow {
  id: number;
  kind: ActivityKind;
  subject: string | null;
  threadId: string | null;
  messageId: string | null;
  detail: string | null;
  createdAt: number;
}

const ACTIVITY_CAP = 200;

/**
 * Record one feed event. Swallows its own errors (warn-level log): callers
 * sit inside the mail-flow hot path, and a feed-write failure must never
 * cost a tick.
 */
export function recordActivity(
  kind: ActivityKind,
  fields: {
    subject?: string;
    threadId?: string;
    messageId?: string;
    detail?: string;
  } = {},
): void {
  try {
    const db = stateDb();
    db.prepare(
      "INSERT INTO activity(kind, subject, threadId, messageId, detail, createdAt) VALUES(?, ?, ?, ?, ?, ?)",
    ).run(
      kind,
      fields.subject ?? null,
      fields.threadId ?? null,
      fields.messageId ?? null,
      fields.detail ?? null,
      Date.now(),
    );
    db.prepare(
      "DELETE FROM activity WHERE id NOT IN (SELECT id FROM activity ORDER BY id DESC LIMIT ?)",
    ).run(ACTIVITY_CAP);
  } catch (err) {
    log.warn({ err, kind }, "activity record failed — continuing");
  }
}

/** Newest-first feed slice — status.json carries recentActivity(50). */
export function recentActivity(limit: number): ActivityRow[] {
  return stateDb()
    .prepare("SELECT * FROM activity ORDER BY id DESC LIMIT ?")
    .all(limit) as ActivityRow[];
}

// --- Watch pause + auth-failure flags ----------------------------------------
// Runtime state, not config: kv-backed so the CLI can flip them while the
// daemon holds the db (WAL — the same cross-process pattern `agent status`
// already uses to read the heartbeat).

export function isWatchPaused(): boolean {
  return getKV("watch:paused") === "1";
}

export function setWatchPaused(paused: boolean): void {
  setKV("watch:paused", paused ? "1" : "");
}

/** An auth failure was hit; status surfaces report reauthNeeded until cleared. */
export function setAuthFailed(): void {
  setKV("auth:failedAt", String(Date.now()));
}

/** Cleared by the next successful (non-paused) watch tick. */
export function clearAuthFailed(): void {
  if (getKV("auth:failedAt")) setKV("auth:failedAt", "");
}

export function authFailedAt(): number | null {
  const v = getKV("auth:failedAt");
  return v ? Number(v) : null;
}
