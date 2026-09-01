import * as p from "@clack/prompts";
import type { Command } from "commander";
import {
  agentStatus,
  heartbeatStatus,
  installAgent,
  uninstallAgent,
} from "../agent/launchd.js";
import { DATA_DIR, loadConfig } from "../config/load.js";
import { getKV, isWatchPaused, setWatchPaused } from "../db/state.js";

/** Config load can fail (missing/malformed config.toml) — `agent status` must still work. */
const DEFAULT_POLL_INTERVAL_SEC = 45;

export function registerAgentCommand(program: Command): void {
  program
    .command("agent <action>")
    .description(
      "Manage the launchd background agent: install | uninstall | status | pause | resume. Pause keeps the daemon alive but stops all watching; the Gmail cursor holds, so mail arriving while paused is drafted on resume (unless paused beyond ~1 week, when Gmail expires the cursor and the interim is skipped).",
    )
    .action(async (action: string) => {
      if (action === "pause") {
        setWatchPaused(true);
        p.log.success(
          "Paused — takes effect within one poll interval. Mail arriving while paused is drafted on resume. Resume: inboxminder agent resume",
        );
      } else if (action === "resume") {
        setWatchPaused(false);
        p.log.success("Resumed — watching again within one poll interval.");
      } else if (action === "install") {
        const { plistPath, cliPath } = await installAgent();
        const { notify } = await import("../notify.js");
        notify("InboxMinder", "Agent installed — watching your inbox");
        p.log.success(`Installed ${plistPath}`);
        p.log.message(
          `Runs: ${cliPath} watch (survives reboots)\nLogs: ${DATA_DIR}/logs/watch.log\nCheck anytime: inboxminder agent status`,
        );
      } else if (action === "uninstall") {
        const existed = uninstallAgent();
        p.log.message(
          existed ? "Agent uninstalled." : "Agent was not installed.",
        );
      } else if (action === "status") {
        const s = agentStatus();
        if (!s.installed) p.log.message("Agent: not installed");
        else if (s.running) {
          let pollIntervalSec = DEFAULT_POLL_INTERVAL_SEC;
          try {
            pollIntervalSec = loadConfig().email.pollIntervalSec;
          } catch {
            // Malformed/missing config — status must still report something.
          }
          const raw = getKV("heartbeat:watch");
          const hb = heartbeatStatus(
            Date.now(),
            raw ? Number(raw) : null,
            pollIntervalSec,
          );
          // The heartbeat keeps ticking while paused, so paused and STALLED
          // can't legitimately coexist — STALLED keeps precedence if they do.
          const paused = isWatchPaused() ? ", paused" : "";
          if (hb.state === "missing") {
            // Fresh install / pre-Plan-019 daemon — no heartbeat recorded yet.
            p.log.message(`Agent: running (pid ${s.pid}${paused})`);
          } else if (hb.state === "stale") {
            p.log.warn(
              `Agent: running (pid ${s.pid}) but STALLED (last tick ${hb.ageDisplay} ago) — run: inboxminder agent install`,
            );
          } else {
            p.log.message(
              `Agent: running (pid ${s.pid}${paused}, last tick ${hb.ageDisplay} ago)`,
            );
          }
        } else
          p.log.warn(
            `Agent: installed but not running — check ${DATA_DIR}/logs/watch.err.log`,
          );
      } else {
        p.log.error(
          `Unknown action "${action}" — use install | uninstall | status | pause | resume`,
        );
        process.exitCode = 1;
      }
    });
}
