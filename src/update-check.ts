import { updateActionText } from "./agent/managed.js";
import type { Config } from "./config/schema.js";
import { getKV, setKV } from "./db/state.js";
import { log } from "./log.js";
import { notify } from "./notify.js";
import { VERSION } from "./version.js";

/*
 * Notify-only update check. The daemon NEVER updates itself — npm/brew
 * own installation; this just tells the user a newer release exists:
 * one HTTPS request to api.github.com at most once per 24h, carrying no
 * user data (disclosed in the README's privacy section; email.updateCheck
 * = false disables it entirely). Fail-soft: an unreachable GitHub costs
 * nothing, ever.
 */

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const RELEASES_URL =
  "https://api.github.com/repos/kelviq/inboxminder/releases/latest";
const KV_LAST_CHECK = "updateCheck:lastAt";
const KV_ETAG = "updateCheck:etag";
const KV_AVAILABLE = "updateCheck:available";

/** "v0.10.2" -> [0,10,2]; anything unparsable -> null. Pure — testable. */
export function parseVersion(tag: string): [number, number, number] | null {
  const m = tag.trim().match(/^v?(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** Is `candidate` strictly newer than `current`? Pure — testable. */
export function isNewerVersion(candidate: string, current: string): boolean {
  const a = parseVersion(candidate);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

/** Newer released version the user hasn't installed, or null. */
export function updateAvailable(): string | null {
  const v = getKV(KV_AVAILABLE);
  return v && isNewerVersion(v, VERSION) ? v : null;
}

/**
 * Run at most once per interval; called from the watch tick (fail-soft —
 * the caller's mail flow must never notice this).
 */
export async function maybeCheckForUpdate(cfg: Config): Promise<void> {
  if (!cfg.email.updateCheck) return;
  const last = Number(getKV(KV_LAST_CHECK) ?? 0);
  if (Date.now() - last < CHECK_INTERVAL_MS) return;
  setKV(KV_LAST_CHECK, String(Date.now()));
  try {
    const headers: Record<string, string> = {
      accept: "application/vnd.github+json",
      "user-agent": "inboxminder-update-check",
    };
    const etag = getKV(KV_ETAG);
    if (etag) headers["if-none-match"] = etag;
    const res = await fetch(RELEASES_URL, {
      headers,
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 304) return; // unchanged since last look
    if (!res.ok) return; // rate limit / outage — try again next interval
    const newEtag = res.headers.get("etag");
    if (newEtag) setKV(KV_ETAG, newEtag);
    const body = (await res.json()) as { tag_name?: string };
    const tag = body.tag_name ?? "";
    const parsed = parseVersion(tag);
    if (!parsed) return;
    const version = parsed.join(".");
    setKV(KV_AVAILABLE, version);
    if (isNewerVersion(version, VERSION)) {
      // Once per version, not per day — a standing update is not news.
      const notifiedKey = `notified:update:${version}`;
      if (!getKV(notifiedKey)) {
        setKV(notifiedKey, String(Date.now()));
        log.info({ current: VERSION, latest: version }, "update available");
        if (cfg.email.notifications)
          notify("InboxMinder", updateActionText(version));
      }
    }
  } catch (err) {
    log.warn({ err }, "update check failed; continuing");
  }
}
