import { renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "../config/load.js";
import { profileName } from "../config/profile.js";
import type { Config } from "../config/schema.js";
import {
  type ActivityRow,
  authFailedAt,
  getKV,
  isWatchPaused,
  recentActivity,
} from "../db/state.js";
import { log } from "../log.js";
import { updateAvailable } from "../update-check.js";
import { staleAfterMs } from "./launchd.js";

/*
 * ~/.inboxminder/status.json — the versioned read surface the menu-bar companion
 * renders. Written by the watch loop every iteration, atomically
 * (tmp + rename) so readers never see a torn file. Contract rules:
 * - `v` bumps on any breaking shape change, in the same commit as the reader.
 * - Content stays OS-neutral (the cross-platform seam).
 * - Privacy budget = notifications: subjects/titles/identifiers/paths only;
 *   never email bodies, retrieved chunks, or draft text.
 */

export const STATUS_VERSION = 1;
const ACTIVITY_IN_STATUS = 50;

export interface StatusFileInputs {
  pid: number;
  tickAt: number;
  pollIntervalSec: number;
  paused: boolean;
  reauthNeeded: boolean;
  selfEmail: string;
  /** Null/absent means the default profile. */
  profile: string | null;
  /** Newer released CLI version, or null. Additive — `v` stays 1. */
  updateAvailable: string | null;
  activity: ActivityRow[];
}

export interface StatusJson {
  v: number;
  pid: number;
  tickAt: number;
  staleAfterMs: number;
  paused: boolean;
  reauthNeeded: boolean;
  selfEmail: string;
  /** Additive — `v` stays 1; readers treat absence as null. */
  profile: string | null;
  /** Additive — `v` stays 1; readers treat absence as null. */
  updateAvailable: string | null;
  activity: Array<{
    kind: string;
    subject: string | null;
    threadId: string | null;
    messageId: string | null;
    detail: string | null;
    at: number;
  }>;
}

/** Pure projection — unit-tested; keep every field derivation in here. */
export function buildStatusJson(inputs: StatusFileInputs): StatusJson {
  return {
    v: STATUS_VERSION,
    pid: inputs.pid,
    tickAt: inputs.tickAt,
    staleAfterMs: staleAfterMs(inputs.pollIntervalSec),
    paused: inputs.paused,
    reauthNeeded: inputs.reauthNeeded,
    selfEmail: inputs.selfEmail,
    profile: inputs.profile,
    updateAvailable: inputs.updateAvailable,
    activity: inputs.activity.slice(0, ACTIVITY_IN_STATUS).map((r) => ({
      kind: r.kind,
      subject: r.subject,
      threadId: r.threadId,
      messageId: r.messageId,
      detail: r.detail,
      at: r.createdAt,
    })),
  };
}

/**
 * Gather live inputs and write the file. Never throws upward — a status-file
 * problem must never stop the watch loop (warn-level log, same posture as
 * every other non-mail concern in the daemon).
 */
export function writeStatusFile(cfg: Config): void {
  try {
    const heartbeat = getKV("heartbeat:watch");
    const json = buildStatusJson({
      pid: process.pid,
      tickAt: heartbeat ? Number(heartbeat) : Date.now(),
      pollIntervalSec: cfg.email.pollIntervalSec,
      paused: isWatchPaused(),
      reauthNeeded: authFailedAt() !== null,
      selfEmail: getKV("gmail:selfEmail") ?? "",
      profile: profileName(),
      updateAvailable: updateAvailable(),
      activity: recentActivity(ACTIVITY_IN_STATUS),
    });
    const path = join(DATA_DIR, "status.json");
    const tmp = `${path}.tmp`;
    writeFileSync(tmp, JSON.stringify(json));
    renameSync(tmp, path);
  } catch (err) {
    log.warn({ err }, "status.json write failed; continuing");
  }
}
