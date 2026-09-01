import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import http from "node:http";
import { OAuth2Client } from "google-auth-library";
import { type gmail_v1, google } from "googleapis";
import { getKV, setKV } from "../db/state.js";
import { log } from "../log.js";
import { getSecret, requireSecret, setSecret } from "../secrets/keychain.js";

// gmail.modify: reading mail + writing labels (threads.modify) — one
// restricted-tier scope, granted to YOUR OWN OAuth app only.
const SCOPES = ["https://www.googleapis.com/auth/gmail.modify"];
const REDIRECT_PORT = 43110;
const REDIRECT = `http://127.0.0.1:${REDIRECT_PORT}/oauth2callback`;

// Every Gmail call — and the token-refresh requests OAuth2Client makes on its
// own gaxios transporter — must have a deadline. A TCP connection that dies
// silently during laptop sleep (no FIN/RST) otherwise leaves the daemon
// awaiting forever; this is the fix for the Aug 5/10/11 hangs.
const REQUEST_TIMEOUT_MS = 60_000;

function oauthClient(): OAuth2Client {
  return new OAuth2Client({
    clientId: requireSecret("gmail-client-id"),
    clientSecret: requireSecret("gmail-client-secret"),
    redirectUri: REDIRECT,
    transporterOptions: { timeout: REQUEST_TIMEOUT_MS },
  });
}

/** One-time browser OAuth flow with a local loopback listener. */
export async function authorizeGmail(): Promise<void> {
  const client = oauthClient();
  const state = randomBytes(16).toString("hex");
  const url = client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
    state,
  });
  console.log(
    `\nOpen this URL in your browser to authorize Gmail access:\n\n${url}\n`,
  );
  // Best-effort convenience (macOS-only tool): open the consent page
  // directly so re-auth spawned from the menu-bar app needs no terminal;
  // the printed URL above stays as the fallback.
  execFile("open", [url], () => {});
  const code = await new Promise<string>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url ?? "", `http://127.0.0.1:${REDIRECT_PORT}`);
      if (u.pathname !== "/oauth2callback") {
        // Stray request (favicon etc.) — ignore and keep waiting for the callback.
        res.statusCode = 404;
        res.end();
        return;
      }
      if (u.searchParams.get("state") !== state) {
        res.statusCode = 403;
        res.end();
        return; // not our flow — keep waiting
      }
      const c = u.searchParams.get("code");
      // Without "connection: close" the browser holds a keep-alive socket and
      // server.close() never completes, leaving the CLI hanging after success.
      res.setHeader("connection", "close");
      res.end(
        c
          ? "InboxMinder is authorized. You can close this tab."
          : "Authorization failed. You can close this tab.",
      );
      server.close();
      if (c) resolve(c);
      else
        reject(
          new Error(
            `OAuth callback returned no code (${u.searchParams.get("error") ?? "unknown error"})`,
          ),
        );
    });
    server.listen(REDIRECT_PORT, "127.0.0.1");
  });
  const { tokens } = await client.getToken(code);
  setSecret("gmail-tokens", JSON.stringify(tokens));
  console.log("Gmail authorized.");
}

function gmail(): gmail_v1.Gmail {
  const client = oauthClient();
  const stored = getSecret("gmail-tokens");
  if (!stored) throw new Error("Gmail not authorized. Run: inboxminder auth");
  client.setCredentials(JSON.parse(stored));
  client.on("tokens", (t) => {
    const merged = { ...JSON.parse(getSecret("gmail-tokens") ?? "{}"), ...t };
    setSecret("gmail-tokens", JSON.stringify(merged));
  });
  return google.gmail({
    version: "v1",
    auth: client,
    timeout: REQUEST_TIMEOUT_MS,
  });
}

export interface InboundMessage {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  messageIdHeader: string;
  references: string;
  listUnsubscribe: boolean;
  bodyText: string;
}

function header(payload: gmail_v1.Schema$MessagePart, name: string): string {
  return (
    payload.headers?.find((h) => h.name?.toLowerCase() === name.toLowerCase())
      ?.value ?? ""
  );
}

/**
 * Decode a part's base64url body honoring its declared charset —
 * web clients still send ISO-8859-1/windows-1252 mail, and decoding those
 * bytes as UTF-8 mangles every accented character feeding the classifier,
 * the draft prompt, and the style index. Unknown labels fall back to utf8.
 */
function decodeBody(part: gmail_v1.Schema$MessagePart): string {
  const data = part.body?.data;
  if (!data) return "";
  const buf = Buffer.from(data, "base64url");
  const charset = header(part, "Content-Type")
    .match(/charset="?([^";\s]+)"?/i)?.[1]
    ?.toLowerCase();
  if (charset && !["utf-8", "utf8", "us-ascii"].includes(charset)) {
    try {
      return new TextDecoder(charset).decode(buf);
    } catch {
      // Unsupported label — utf8 is the least-bad fallback.
    }
  }
  return buf.toString("utf8");
}

/**
 * Single-pass entity decode for the handful that dominate real email HTML.
 * One pass on purpose: "&amp;lt;" must become "&lt;", never "<" — iterative
 * replacement double-decodes. Unknown entities pass through untouched.
 */
function decodeEntities(text: string): string {
  const named: Record<string, string> = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " ",
  };
  return text.replace(/&(#\d+|[a-z]+);/gi, (whole, entity: string) => {
    if (entity.startsWith("#")) {
      const code = Number(entity.slice(1));
      return Number.isFinite(code) ? String.fromCharCode(code) : whole;
    }
    return named[entity.toLowerCase()] ?? whole;
  });
}

/** Regex-level HTML→text — deliberately no parsing dependency (lean rule). */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<head[\s\S]*?<\/head>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " "),
  );
}

/**
 * Body text for the whole pipeline (classifier, draft prompt, style index).
 * Two passes on purpose: text/plain from ANYWHERE in the part
 * tree wins over text/html — an explicit preference, not a dependency on
 * Gmail happening to order plain before html inside multipart/alternative.
 * Exported for tests only.
 */
export function extractText(payload: gmail_v1.Schema$MessagePart): string {
  const findPlain = (part: gmail_v1.Schema$MessagePart): string => {
    if (part.mimeType === "text/plain" && part.body?.data)
      return decodeBody(part);
    for (const child of part.parts ?? []) {
      const t = findPlain(child);
      if (t) return t;
    }
    return "";
  };
  const findHtml = (part: gmail_v1.Schema$MessagePart): string => {
    if (part.mimeType === "text/html" && part.body?.data)
      return htmlToText(decodeBody(part));
    for (const child of part.parts ?? []) {
      const t = findHtml(child);
      if (t) return t;
    }
    return "";
  };
  return findPlain(payload) || findHtml(payload);
}

export interface MailHistory {
  inboxIds: string[];
  sentIds: string[];
}

/**
 * Poll for messages added to INBOX (and, when `includeSent` is set, SENT)
 * since the stored history cursor, in the same tick.
 *
 * Cursor safety: both label queries share ONE cursor (`gmail:historyId`).
 * Each is fully drained (all pages) into memory before either result is
 * used, and `cursor` — the max history *record* id seen across BOTH label
 * streams — is written to KV exactly once, only after every query has
 * resolved. If any query throws partway through (including the SENT query,
 * which runs after INBOX), execution jumps straight to the catch block
 * below and nothing has been written yet: the stored cursor is left exactly
 * where it was. So a failure specific to the SENT query can never cause the
 * cursor to advance past unprocessed INBOX records, or vice versa — it's an
 * all-or-nothing commit. The catch then resets to "now" ONLY on a genuine
 * cursor expiry (404); anything else rethrows with the cursor
 * untouched, uniformly for both labels.
 *
 * When `includeSent` is false, this call is byte-for-byte the same single
 * INBOX query + same single cursor commit as before — zero behavior change
 * for installs with follow-ups disabled.
 */
/**
 * Pure fold of Gmail history pages: collect added message ids
 * (deduped) and advance the cursor to the max history RECORD id seen —
 * NOT the mailbox head (res.data.historyId): records can materialize
 * slightly behind the head, and storing the head would skip those messages
 * forever (this exact bug lost mail once — commit 837b1bb). Unprocessed
 * re-reads are harmless; the drafted table dedups. BigInt comparison on
 * purpose: record ids exceed Number.MAX_SAFE_INTEGER in real mailboxes.
 */
export function foldHistory(
  pages: gmail_v1.Schema$ListHistoryResponse[],
  last: string,
): { ids: string[]; cursor: string } {
  let cursor = BigInt(last);
  const ids = new Set<string>();
  for (const page of pages) {
    for (const h of page.history ?? []) {
      if (h.id && BigInt(h.id) > cursor) cursor = BigInt(h.id);
      for (const m of h.messagesAdded ?? [])
        if (m.message?.id) ids.add(m.message.id);
    }
  }
  return { ids: [...ids], cursor: cursor.toString() };
}

export async function pollMailHistory(
  includeSent: boolean,
): Promise<MailHistory> {
  const g = gmail();
  const last = getKV("gmail:historyId");
  if (!last) {
    const profile = await g.users.getProfile({ userId: "me" });
    setKV("gmail:historyId", String(profile.data.historyId));
    setKV("gmail:selfEmail", profile.data.emailAddress ?? "");
    log.info("initialized gmail cursor — watching from now on");
    return { inboxIds: [], sentIds: [] };
  }
  try {
    const fetchPages = async (
      labelId: string,
    ): Promise<gmail_v1.Schema$ListHistoryResponse[]> => {
      const pages: gmail_v1.Schema$ListHistoryResponse[] = [];
      let pageToken: string | undefined;
      do {
        const res = await g.users.history.list({
          userId: "me",
          startHistoryId: last,
          historyTypes: ["messageAdded"],
          labelId,
          pageToken,
        });
        pages.push(res.data);
        pageToken = res.data.nextPageToken ?? undefined;
      } while (pageToken);
      return pages;
    };
    // Both queries are drained to completion before either result is used
    // or the cursor is written — see the cursor-safety doc comment above.
    const inboxPages = await fetchPages("INBOX");
    const sentPages = includeSent ? await fetchPages("SENT") : [];
    // Chained folds = one cursor across both label streams (max of all).
    const inbox = foldHistory(inboxPages, last);
    const sent = foldHistory(sentPages, inbox.cursor);
    if (BigInt(sent.cursor) > BigInt(last))
      setKV("gmail:historyId", sent.cursor);
    return { inboxIds: inbox.ids, sentIds: sent.ids };
  } catch (err) {
    // Gmail signals an invalid/expired startHistoryId with HTTP 404 (same
    // status-extraction pattern as getMessage below). Anything else — a
    // network drop, 429, 5xx, auth failure — must NOT reset the cursor:
    // each false reset silently skips every email since the last good poll.
    const status =
      (err as { status?: number; response?: { status?: number } }).status ??
      (err as { response?: { status?: number } }).response?.status;
    if (status === 404) {
      // History cursors expire (~1 week). Reset and continue from now.
      log.warn("gmail history expired — resetting cursor");
      const profile = await g.users.getProfile({ userId: "me" });
      setKV("gmail:historyId", String(profile.data.historyId));
      return { inboxIds: [], sentIds: [] };
    }
    throw err; // transient — watcher retries next tick with cursor intact
  }
}

export async function getMessage(id: string): Promise<InboundMessage | null> {
  const g = gmail();
  let res: { data: gmail_v1.Schema$Message };
  try {
    res = await g.users.messages.get({ userId: "me", id, format: "full" });
  } catch (err) {
    // Deleted between history poll and fetch (spam purge, quick manual
    // delete). Gone is gone — treat like "no message".
    const status =
      (err as { status?: number; response?: { status?: number } }).status ??
      (err as { response?: { status?: number } }).response?.status;
    if (status === 404) return null;
    throw err;
  }
  const payload = res.data.payload;
  if (!payload) return null;
  return {
    id,
    threadId: res.data.threadId ?? "",
    from: header(payload, "From"),
    to: header(payload, "To"),
    subject: header(payload, "Subject"),
    messageIdHeader: header(payload, "Message-ID"),
    references: header(payload, "References"),
    listUnsubscribe: !!header(payload, "List-Unsubscribe"),
    bodyText: extractText(payload).trim(),
  };
}

/**
 * Resolve a label NAME to its id, creating the label on first use ("/" in
 * the name nests it in Gmail's sidebar). Ids are kv-cached; the cache is
 * cleared by the caller on a stale-id failure.
 */
async function labelId(g: gmail_v1.Gmail, name: string): Promise<string> {
  const cacheKey = `gmail:label:${name}`;
  const cached = getKV(cacheKey);
  if (cached) return cached;
  const listed = await g.users.labels.list({ userId: "me" });
  const found = listed.data.labels?.find((l) => l.name === name);
  if (found?.id) {
    setKV(cacheKey, found.id);
    return found.id;
  }
  const created = await g.users.labels.create({
    userId: "me",
    requestBody: {
      name,
      labelListVisibility: "labelShow",
      messageListVisibility: "show",
    },
  });
  if (!created.data.id) throw new Error(`label create returned no id: ${name}`);
  setKV(cacheKey, created.data.id);
  return created.data.id;
}

/**
 * Triage-label projection: one threads.modify applying/removing
 * labels BY NAME. Retries once with cleared id caches when a cached id has
 * gone stale (user deleted the label in Gmail). Requires the gmail.modify
 * scope — callers are fail-soft and surface `inboxminder auth` on a 403.
 */
export async function setThreadLabels(
  threadId: string,
  addNames: string[],
  removeNames: string[],
): Promise<void> {
  const g = gmail();
  const attempt = async () => {
    const [addLabelIds, removeLabelIds] = await Promise.all([
      Promise.all(addNames.map((n) => labelId(g, n))),
      Promise.all(removeNames.map((n) => labelId(g, n))),
    ]);
    await g.users.threads.modify({
      userId: "me",
      id: threadId,
      requestBody: { addLabelIds, removeLabelIds },
    });
  };
  try {
    await attempt();
  } catch (err) {
    if (!/invalid label|label.*not.?found/i.test(String(err))) throw err;
    for (const n of [...addNames, ...removeNames])
      setKV(`gmail:label:${n}`, "");
    await attempt();
  }
}
