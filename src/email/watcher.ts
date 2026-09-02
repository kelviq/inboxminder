import { rotateLogIfLarge } from "../agent/launchd.js";
import { writeStatusFile } from "../agent/status-file.js";
import type { Config, TriageCategory } from "../config/schema.js";
import {
  alreadyHandled,
  bumpPendingAttempt,
  clearAuthFailed,
  enqueuePending,
  getKV,
  hasCorrespondent,
  isWatchPaused,
  listPending,
  MAX_PENDING_ATTEMPTS,
  markHandled,
  pruneOldState,
  recordActivity,
  recordCorrespondents,
  resolvePending,
  setAuthFailed,
  setKV,
} from "../db/state.js";
import { classifyReplyWorthiness } from "../engine/classify.js";
import { log } from "../log.js";
import { notify } from "../notify.js";
import type { InboundMessage } from "./gmail.js";
import type { MailProvider } from "./provider.js";
import { mailProvider } from "./provider.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const REAUTH_NOTIFY_GAP_MS = 6 * 60 * 60 * 1000;

/** Expired/revoked refresh token — the one failure polling can't ride out. */
function isAuthError(err: unknown): boolean {
  return /invalid_grant|Gmail not authorized/i.test(String(err));
}

/**
 * An auth failure was hit somewhere in the loop: flag it for the status
 * surfaces immediately (kv "auth:failedAt", cleared by the next successful
 * non-paused tick), then notify + record activity at most once per 6h —
 * the failure repeats every tick until the human re-auths, and a
 * notification storm helps nobody.
 */
function reportAuthFailure(cfg: Config): void {
  setAuthFailed();
  const last = Number(getKV("notified:reauth") ?? 0);
  if (Date.now() - last < REAUTH_NOTIFY_GAP_MS) return;
  setKV("notified:reauth", String(Date.now()));
  recordActivity("reauth", {});
  if (cfg.email.notifications)
    notify(
      "InboxMinder",
      "Gmail authorization expired — run: inboxminder auth",
    );
}

/**
 * The address inside a From header. Display names are untrusted
 * decoration: "The Noreply Band <band@x.com>" is not a noreply sender, and
 * a sender writing the user's own address into a display name must not be
 * able to force a skip.
 */
export function fromAddress(header: string): string {
  return (header.match(/<([^>]+)>/)?.[1] ?? header).trim().toLowerCase();
}

/**
 * Why this message gets no classifier call at all, or null to proceed.
 * Deliberately tiny: the classifier IS the product, so only mail that is
 * meaningless to classify skips it — the user's own messages, bounces
 * (skipSenders), and empty bodies. Pure — testable.
 */
export function skipReason(
  cfg: Config,
  msg: InboundMessage,
  self: string,
): string | null {
  const addr = fromAddress(msg.from);
  if (self && addr === self) return "self-sender";
  if (cfg.email.skipSenders.some((s) => addr.includes(s)))
    return "skipSenders match";
  if (!msg.bodyText) return "empty body";
  return null;
}

/**
 * Every address in a recipient header (To can be a list). Display names are
 * ignored the same way fromAddress ignores them — only address tokens are
 * extracted. Pure — testable.
 */
export function toAddresses(header: string): string[] {
  return (header.toLowerCase().match(/[^\s,<>";]+@[^\s,<>";]+/g) ?? []).map(
    (a) => a.trim(),
  );
}

/** Fixed category -> label map (names not configurable in v1). */
export const TRIAGE_LABELS: Record<TriageCategory, string> = {
  newsletter: "InboxMinder/Newsletter",
  notification: "InboxMinder/Notification",
  marketing: "InboxMinder/Marketing",
  "cold-outreach": "InboxMinder/Cold Outreach",
  fyi: "InboxMinder/FYI",
};

export const IMPORTANT_LABEL = "InboxMinder/Important";

/**
 * Known-correspondent guard: can this sender NOT be a stranger? Two cheap
 * signals, each erring toward suppression (a missed Cold Outreach label is
 * fine; a real contact labeled cold is the complaint axis): References =
 * the mail is part of an existing conversation; the correspondents ledger
 * = the user has been observed writing to this address.
 */
export function knownCorrespondent(msg: InboundMessage): boolean {
  if (msg.references) return true;
  return hasCorrespondent(fromAddress(msg.from));
}

/**
 * Is this SENT-label message a genuine outbound reply (used for the
 * Resolved label + the correspondents ledger), or a self-sent notification
 * loop (e.g. a contact-form email the user's own site sends from their
 * address to itself)? Pure — testable.
 */
export function isOutboundReply(msg: InboundMessage, self: string): boolean {
  if (!self) return true;
  const from = msg.from.toLowerCase();
  const to = msg.to.toLowerCase();
  return !(from.includes(self) && to.includes(self));
}

/**
 * Apply a triage category label, with the archive gate and the Cold
 * Outreach guard. Label + INBOX removal ride ONE threads.modify — atomic,
 * so an archived thread can never lack its audit-trail label. Fail-soft:
 * labeling never costs the tick.
 */
async function applyTriageCategory(
  cfg: Config,
  mail: MailProvider,
  msg: InboundMessage,
  category: TriageCategory | undefined,
): Promise<void> {
  if (!category || !msg.threadId) return;
  if (category === "cold-outreach" && knownCorrespondent(msg)) {
    log.info(
      { from: msg.from, subject: msg.subject },
      "triage: known correspondent — cold-outreach label suppressed",
    );
    return;
  }
  const archive = cfg.triage.archive.includes(category);
  try {
    await mail.setThreadLabels?.(
      msg.threadId,
      [TRIAGE_LABELS[category]],
      archive ? ["INBOX"] : [],
    );
    log.info(
      { from: msg.from, subject: msg.subject, category, archived: archive },
      "triage: category labeled",
    );
    recordActivity("labeled", {
      subject: msg.subject,
      threadId: msg.threadId,
      messageId: msg.messageIdHeader || undefined,
      detail: archive ? `${category} · archived` : category,
    });
  } catch (err) {
    log.warn(
      { err, threadId: msg.threadId, category },
      "triage label failed — continuing (insufficient scope? run: inboxminder auth)",
    );
  }
}

/**
 * One watcher tick: poll Gmail history, classify + label new mail, observe
 * the user's own replies. Returns false when paused (kv "watch:paused",
 * set by `inboxminder agent pause`): no Gmail poll — the history cursor
 * holds, so resume triages the backlog — and the caller knows this was
 * not a real, auth-verifying tick.
 */
export async function runWatchTick(cfg: Config): Promise<boolean> {
  if (isWatchPaused()) return false;
  const mail = mailProvider(cfg);
  const triageOn = !!cfg.triage?.enabled && !!mail.setThreadLabels;
  const labelsOn = !!cfg.labels?.enabled && !!mail.setThreadLabels;
  // Sent observation feeds the Resolved label and the known-correspondent
  // ledger — only fetched when a feature consumes it.
  const ids = await mail.pollMailHistory(labelsOn || triageOn);
  // Durability point: record every discovered inbox id BEFORE any
  // processing. The history cursor advanced at discovery, so without this
  // a failure anywhere downstream (LLM 429, Gmail 5xx, crash mid-batch)
  // would lose the email permanently — it never reappears in a future
  // history page. From here the queue is the work list: ids retry across
  // ticks until handled, skipped, or abandoned at MAX_PENDING_ATTEMPTS.
  enqueuePending(ids.inboxIds);
  const self = (getKV("gmail:selfEmail") ?? "").toLowerCase();

  if (labelsOn || triageOn) {
    for (const id of ids.sentIds) {
      try {
        const msg = await mail.getMessage(id);
        if (!msg?.threadId) continue;
        if (!isOutboundReply(msg, self)) continue;
        if (triageOn) {
          // Known-correspondent ledger: anyone the user writes to can
          // never be labeled Cold Outreach from here on.
          recordCorrespondents(toAddresses(msg.to));
        }
        if (labelsOn) {
          // Auto-resolve: the user sending their reply IS the resolution.
          // Fail-soft — labels never cost the tick.
          try {
            await mail.setThreadLabels?.(
              msg.threadId,
              [cfg.labels.resolved],
              [cfg.labels.pending],
            );
          } catch (err) {
            log.warn(
              { err, threadId: msg.threadId },
              "label resolve failed — continuing (insufficient scope? run: inboxminder auth)",
            );
          }
        }
      } catch (err) {
        if (isAuthError(err)) throw err;
        log.error({ err, id }, "outbound tracking failed — continuing");
      }
    }
  }

  for (const { messageId: id } of listPending()) {
    // Isolate each message: one bad message must not abort its siblings —
    // they stay queued and retry, but same-tick processing should continue.
    try {
      if (alreadyHandled(id)) {
        resolvePending(id);
        continue;
      }
      const msg = await mail.getMessage(id);
      if (!msg) {
        // Deleted between discovery and fetch — gone is gone.
        resolvePending(id);
        continue;
      }

      const reason = skipReason(cfg, msg, self);
      if (reason) {
        log.info({ from: msg.from, subject: msg.subject, reason }, "skipping");
        resolvePending(id);
        continue;
      }
      if (!triageOn && !labelsOn) {
        // Both projections disabled — a classifier verdict would have no
        // consumer, so don't spend the LLM call.
        resolvePending(id);
        continue;
      }

      // The one classifier call per email — reply-worthiness, category,
      // and importance in the same verdict. Fail-open: classifier errors
      // report reply=true with no category, so broken LLM config can
      // never archive or mis-file mail as a side effect.
      const verdict = await classifyReplyWorthiness(cfg, msg);
      if (!verdict.reply) {
        // Mark as handled so crash-window re-reads don't re-classify.
        markHandled(id);
        resolvePending(id);
        log.info(
          { from: msg.from, subject: msg.subject, reason: verdict.reason },
          "no reply expected",
        );
        if (triageOn)
          await applyTriageCategory(cfg, mail, msg, verdict.category);
        continue;
      }

      // Reply-worthy: never categorized or archived — the needs-you path
      // wins. Project the state onto labels instead.
      log.info(
        {
          from: msg.from,
          subject: msg.subject,
          important: !!verdict.important,
        },
        "reply expected",
      );
      if (labelsOn && msg.threadId) {
        // Pending projection: the thread needs the user. This same path
        // re-pends a previously resolved thread when the other side
        // replies again.
        try {
          await mail.setThreadLabels?.(
            msg.threadId,
            [cfg.labels.pending],
            [cfg.labels.resolved],
          );
        } catch (err) {
          log.warn(
            { err, threadId: msg.threadId },
            "label pending failed — continuing (insufficient scope? run: inboxminder auth)",
          );
        }
      }
      if (triageOn && verdict.important && msg.threadId) {
        // Importance tier: urgent/blocking mail gets a searchable,
        // sidebar-pinnable label — Gmail can't be reordered by an app,
        // and its own importance markers/stars carry user/Google
        // semantics this tool must not fight.
        try {
          await mail.setThreadLabels?.(msg.threadId, [IMPORTANT_LABEL], []);
          recordActivity("important", {
            subject: msg.subject,
            threadId: msg.threadId,
            messageId: msg.messageIdHeader || undefined,
          });
        } catch (err) {
          log.warn(
            { err, threadId: msg.threadId },
            "important label failed — continuing (insufficient scope? run: inboxminder auth)",
          );
        }
        if (cfg.email.notifications)
          notify("InboxMinder", `Important — ${msg.subject}`);
      }
      markHandled(id);
      resolvePending(id);
    } catch (err) {
      // Auth errors rethrow WITHOUT bumping: nothing else will succeed
      // either, and a re-auth outage must not burn the retry budget.
      if (isAuthError(err)) throw err;
      const attempts = bumpPendingAttempt(id);
      if (attempts === MAX_PENDING_ATTEMPTS)
        log.error(
          { id, attempts },
          "giving up on message — max pending attempts reached",
        );
      log.error({ err, id }, "message processing failed — will retry");
    }
  }
  return true;
}

export async function runWatcher(cfg: Config): Promise<void> {
  log.info({ pollIntervalSec: cfg.email.pollIntervalSec }, "watcher started");
  // Startup hygiene: rotate an oversized log (the fd we hold keeps writing
  // the renamed file until next restart — stopgap by design) and prune
  // expired dedup/retry state.
  rotateLogIfLarge();
  pruneOldState();
  for (;;) {
    // Written before any awaits below so `agent status` can detect a
    // frozen loop (event loop parked mid-await, e.g. on a dead TCP socket)
    // even though the process is still alive.
    setKV("heartbeat:watch", String(Date.now()));
    // status.json — the machine-readable status surface. Written every
    // iteration, paused or not; fail-soft internally.
    writeStatusFile(cfg);
    try {
      // A paused tick is a no-op success — it proves nothing about auth,
      // so only a real tick clears the re-auth flag.
      if (await runWatchTick(cfg)) clearAuthFailed();
    } catch (err) {
      log.error({ err }, "watcher tick failed");
      if (isAuthError(err)) reportAuthFailure(cfg);
    }
    await sleep(cfg.email.pollIntervalSec * 1000);
  }
}
