import type { Command } from "commander";
import {
  CONFIG_PATH,
  loadConfig,
  readRawConfig,
  saveConfigToml,
} from "../config/load.js";
import {
  applySettings,
  SettingsSchema,
  settingsFromConfig,
} from "../config/settings.js";
import { readStdinText } from "./stdin.js";

/**
 * Machine-facing config surface — raw console output, the --stdin idiom.
 * The Preferences window drives these; humans get the same commands for
 * scripting.
 */
export function registerConfigCommand(program: Command): void {
  program
    .command("config <action>")
    .description(
      "Read/update config.toml through a validated funnel. get-settings prints the settings JSON; set-settings --stdin applies one; a change applies to the daemon after a restart. Keys not in the document are preserved. Create config with `inboxminder init` first.",
    )
    .option("--stdin", "read the JSON document from stdin")
    .action(async (action: string, opts: { stdin?: boolean }) => {
      if (action === "get-settings") {
        console.log(JSON.stringify(settingsFromConfig(loadConfig())));
      } else if (action === "set-settings") {
        if (!opts.stdin) {
          console.error("set-settings requires --stdin (JSON document)");
          process.exitCode = 1;
          return;
        }
        const raw = readRawConfig();
        if (raw === null) {
          console.error(`No config at ${CONFIG_PATH}; run: inboxminder init`);
          process.exitCode = 1;
          return;
        }
        let doc: unknown;
        try {
          doc = JSON.parse(await readStdinText());
        } catch {
          console.error("stdin was not valid JSON");
          process.exitCode = 1;
          return;
        }
        const parsed = SettingsSchema.safeParse(doc);
        if (!parsed.success) {
          console.error(`Invalid settings document: ${parsed.error.message}`);
          process.exitCode = 1;
          return;
        }
        saveConfigToml(applySettings(raw, parsed.data));
        console.log(
          `Settings updated in ${CONFIG_PATH}; restart the agent to apply: inboxminder agent install`,
        );
      } else {
        console.error(
          `Unknown action "${action}"; use get-settings | set-settings`,
        );
        process.exitCode = 1;
      }
    });
}
