import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DATA_DIR, ensureDirs } from "../config/load.js";
import { profileName } from "../config/profile.js";

/**
 * Per-profile launchd label. The prefix is stable
 * ("com.inboxminder.agent") so the app can glob `com.inboxminder.agent.*.plist`
 * for named profiles; the default profile keeps the exact historical
 * label — the live daemon depends on that.
 */
export function labelFor(profile: string | null): string {
  return profile ? `com.inboxminder.agent.${profile}` : "com.inboxminder.agent";
}

export function plistPathFor(profile: string | null): string {
  return join(
    homedir(),
    "Library",
    "LaunchAgents",
    `${labelFor(profile)}.plist`,
  );
}

export const LABEL = labelFor(profileName());
export const PLIST_PATH = plistPathFor(profileName());

/**
 * Absolute path of the built CLI. With code splitting this
 * module can live in dist/cli.js OR any dist/chunk-*.js — resolve cli.js
 * relative to whichever dist dir we're in, never by counting parent dirs
 * from the bundle (that walked out of the repo when this landed in a
 * chunk). Running from src via tsx: src/agent/launchd.ts -> <root>/dist.
 */
export function resolveCliPath(): string {
  const self = fileURLToPath(import.meta.url);
  const dir = dirname(self);
  if (basename(dir) === "dist") return join(dir, "cli.js");
  return join(dirname(dirname(dir)), "dist", "cli.js");
}

const xmlEscape = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * launchd runs the BUILT cli with the exact node binary installing it.
 * `env` entries become an EnvironmentVariables dict — how a plist selects
 * its profile (env, not argv, so every spawned code path inherits it).
 * Empty env renders NO block: the default profile's plist stays
 * byte-identical to pre-profile output.
 */
export function renderPlist(
  nodePath: string,
  cliPath: string,
  env: Record<string, string> = {},
): string {
  const logDir = join(DATA_DIR, "logs");
  const envEntries = Object.entries(env);
  const envBlock =
    envEntries.length === 0
      ? ""
      : `  <key>EnvironmentVariables</key>
  <dict>
${envEntries
  .map(
    ([k, v]) =>
      `    <key>${xmlEscape(k)}</key>\n    <string>${xmlEscape(v)}</string>`,
  )
  .join("\n")}
  </dict>
`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xmlEscape(nodePath)}</string>
    <string>${xmlEscape(cliPath)}</string>
    <string>watch</string>
  </array>
${envBlock}  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${xmlEscape(join(logDir, "watch.log"))}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEscape(join(logDir, "watch.err.log"))}</string>
</dict>
</plist>
`;
}

/**
 * Env vars the installed agent must carry: the profile selector plus any
 * base-dir overrides active at install time (so a sandboxed/test install
 * spawns a sandboxed daemon). Default profile with no overrides → empty.
 */
export function agentEnv(
  env: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  const out: Record<string, string> = {};
  const profile = profileName(env);
  if (profile) out.INBOXMINDER_PROFILE = profile;
  if (env.INBOXMINDER_DATA_DIR)
    out.INBOXMINDER_DATA_DIR = env.INBOXMINDER_DATA_DIR;
  if (env.INBOXMINDER_CONFIG_DIR)
    out.INBOXMINDER_CONFIG_DIR = env.INBOXMINDER_CONFIG_DIR;
  return out;
}

const domain = () => `gui/${process.getuid?.() ?? 501}`;

function launchctl(...args: string[]): string {
  // Pipe stderr so expected failures (bootout of a non-loaded agent) don't
  // leak noise to the user's terminal; errors still throw with the message.
  return execFileSync("launchctl", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export interface AgentStatus {
  installed: boolean;
  running: boolean;
  pid: number | null;
}

export function agentStatus(
  label: string = LABEL,
  plistPath: string = PLIST_PATH,
): AgentStatus {
  const installed = existsSync(plistPath);
  try {
    // "PID Status Label" — PID is "-" when loaded but not running.
    const line = launchctl("list")
      .split("\n")
      .find((l) => l.trim().endsWith(label));
    if (!line) return { installed, running: false, pid: null };
    const pid = Number.parseInt(line.trim().split(/\s+/)[0], 10);
    return {
      installed,
      running: Number.isFinite(pid),
      pid: Number.isFinite(pid) ? pid : null,
    };
  } catch {
    return { installed, running: false, pid: null };
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitUnloaded(): Promise<void> {
  // bootout returns before the service fully drains; bootstrapping the same
  // label too early fails with EIO. Poll until launchd forgets the label.
  for (let i = 0; i < 50; i++) {
    try {
      launchctl("print", `${domain()}/${LABEL}`);
    } catch {
      return; // print fails -> label gone
    }
    await sleep(100);
  }
}

const MAX_LOG_BYTES = 10 * 1024 * 1024;

/**
 * Single-slot size-capped rotation: watch.log over 10 MB
 * renames to watch.log.1, clobbering the previous slot. Safe at
 * installAgent time (pre-bootstrap — launchd reopens fresh files); at
 * watcher startup the daemon's already-open stdout fd keeps writing the
 * renamed file until the next restart — acknowledged stopgap; a pino
 * rolling transport is the durable answer if volume ever grows.
 */
export function rotateLogIfLarge(): void {
  const logPath = join(DATA_DIR, "logs", "watch.log");
  try {
    if (statSync(logPath).size > MAX_LOG_BYTES)
      renameSync(logPath, `${logPath}.1`);
  } catch {
    // absent/unreadable — nothing to rotate
  }
}

export async function installAgent(): Promise<{
  plistPath: string;
  cliPath: string;
}> {
  const cliPath = resolveCliPath();
  if (!existsSync(cliPath)) {
    throw new Error(`Built CLI not found at ${cliPath} — run: pnpm build`);
  }
  ensureDirs(); // launchd needs the log dir to exist before first write
  rotateLogIfLarge();
  mkdirSync(dirname(PLIST_PATH), { recursive: true }); // ~/Library/LaunchAgents may not exist
  writeFileSync(PLIST_PATH, renderPlist(process.execPath, cliPath, agentEnv()));
  try {
    launchctl("bootout", `${domain()}/${LABEL}`);
  } catch {
    // Not loaded — fine.
  }
  await waitUnloaded();
  launchctl("bootstrap", domain(), PLIST_PATH);
  return { plistPath: PLIST_PATH, cliPath };
}

/** Renders a millisecond age as a short human string: "32s", "5m", "35h". */
export function formatAge(ms: number): string {
  const sec = Math.max(0, Math.round(ms / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.round(min / 60);
  return `${hr}h`;
}

export interface HeartbeatStatus {
  state: "missing" | "ok" | "stale";
  ageMs: number | null;
  /** Human-readable age, e.g. "32s" — null only when state is "missing". */
  ageDisplay: string | null;
}

/**
 * Stale is declared at 5 missed ticks so one slow poll doesn't
 * false-positive. The ×5 rule lives ONLY here — status.json ships the
 * computed value so readers (the menu-bar app) never re-derive it.
 */
export function staleAfterMs(pollIntervalSec: number): number {
  return 5 * pollIntervalSec * 1000;
}

/**
 * Pure staleness decision for the watch loop's tick heartbeat (`kv` key
 * "heartbeat:watch"). A `launchctl`-reported "running" pid tells you the
 * process exists, not that its event loop is still turning — the Aug 5/10/11
 * hangs were all a live process parked forever on a dead await.
 */
export function heartbeatStatus(
  nowMs: number,
  heartbeatMs: number | null,
  pollIntervalSec: number,
): HeartbeatStatus {
  if (heartbeatMs === null) {
    return { state: "missing", ageMs: null, ageDisplay: null };
  }
  const ageMs = Math.max(0, nowMs - heartbeatMs);
  return {
    state: ageMs > staleAfterMs(pollIntervalSec) ? "stale" : "ok",
    ageMs,
    ageDisplay: formatAge(ageMs),
  };
}

export function uninstallAgent(): boolean {
  const existed = existsSync(PLIST_PATH);
  try {
    launchctl("bootout", `${domain()}/${LABEL}`);
  } catch {
    // Not loaded — fine.
  }
  if (existed) rmSync(PLIST_PATH);
  return existed;
}
