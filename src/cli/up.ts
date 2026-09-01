import { existsSync } from "node:fs";
import * as p from "@clack/prompts";
import type { Command } from "commander";
import { CONFIG_PATH } from "../config/load.js";
import { getSecret } from "../secrets/keychain.js";
import { goLive } from "./golive.js";

export function registerUpCommand(program: Command): void {
  program
    .command("up")
    .description(
      "One command to go live: authorize Gmail if needed, index all sources, install the background agent",
    )
    .action(async () => {
      if (!existsSync(CONFIG_PATH)) {
        p.log.error("No config found — run: inboxminder init");
        process.exitCode = 1;
        return;
      }
      if (!getSecret("gmail-client-id") || !getSecret("gmail-client-secret")) {
        p.log.error(
          "Gmail OAuth client missing — run: inboxminder init (or inboxminder set-key gmail-client-id / gmail-client-secret). See README for the Google Cloud steps.",
        );
        process.exitCode = 1;
        return;
      }
      await goLive();
    });
}
