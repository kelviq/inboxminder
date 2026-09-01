import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as p from "@clack/prompts";
import type { Command } from "commander";
import { BASE_DATA_DIR } from "../config/load.js";
import { profileName } from "../config/profile.js";

interface ProfileRow {
  /** null = the default profile. */
  name: string | null;
  dataDir: string;
}

/** Default profile + every directory under <base>/profiles. Read-only. */
export function discoverProfiles(baseDataDir: string): ProfileRow[] {
  const rows: ProfileRow[] = [{ name: null, dataDir: baseDataDir }];
  const profilesDir = join(baseDataDir, "profiles");
  if (existsSync(profilesDir)) {
    for (const entry of readdirSync(profilesDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      rows.push({ name: entry.name, dataDir: join(profilesDir, entry.name) });
    }
  }
  return rows;
}

function selfEmailOf(dataDir: string): string | null {
  try {
    const raw = readFileSync(join(dataDir, "status.json"), "utf8");
    const email = JSON.parse(raw).selfEmail;
    return typeof email === "string" && email !== "" ? email : null;
  } catch {
    return null;
  }
}

export function registerProfilesCommand(program: Command): void {
  program
    .command("profiles")
    .description(
      "List profiles (default + everything under the data dir's profiles/) with agent state. Create one implicitly: inboxminder --profile <name> init",
    )
    .action(async () => {
      // Lazy: `profiles` must not pay for anything beyond launchctl.
      const { agentStatus, labelFor, plistPathFor } = await import(
        "../agent/launchd.js"
      );
      const active = profileName();
      const rows = discoverProfiles(BASE_DATA_DIR);
      // The active profile may not have a data dir yet (pre-init) — it
      // still belongs in its own listing.
      if (active && !rows.some((r) => r.name === active)) {
        rows.push({
          name: active,
          dataDir: join(BASE_DATA_DIR, "profiles", active),
        });
      }
      for (const row of rows) {
        const s = agentStatus(labelFor(row.name), plistPathFor(row.name));
        const run = s.running
          ? `running (pid ${s.pid})`
          : s.installed
            ? "installed, not running"
            : "not installed";
        const parts = [
          row.name ?? "default",
          selfEmailOf(row.dataDir) ?? "no mailbox yet",
          run,
        ];
        if (row.name === active || (row.name === null && active === null)) {
          parts.push("(active)");
        }
        p.log.message(parts.join("  ·  "));
      }
    });
}
