import { existsSync, readFileSync } from "node:fs";
import type { Command } from "commander";
import { parse } from "smol-toml";
import { PLIST_PATH } from "../agent/launchd.js";
import { CONFIG_PATH } from "../config/load.js";
import { ConfigSchema } from "../config/schema.js";
import { getSecret } from "../secrets/keychain.js";

/**
 * The setup ledger behind `setup-status`, pure-ish for tests: which
 * pieces of a working install exist. The onboarding wizard (plan 053)
 * derives its resume point from this instead of reading the Keychain
 * itself — the app's no-Keychain rule holds because the CLI, which
 * legitimately owns secrets, answers yes/no about their EXISTENCE and
 * never prints a value.
 */
export interface SetupStatus {
  config: boolean;
  llmKey: boolean;
  gmailClient: boolean;
  gmailTokens: boolean;
  agent: boolean;
}

export function collectSetupStatus(deps: {
  configExists: boolean;
  configText: () => string;
  hasSecret: (name: string) => boolean;
  agentPlistExists: boolean;
}): SetupStatus {
  let llmKey = false;
  if (deps.configExists) {
    try {
      const cfg = ConfigSchema.parse(parse(deps.configText()));
      llmKey = deps.hasSecret(cfg.llm.provider);
    } catch {
      // Unparsable config: report config present, key unknown-false —
      // the wizard sends the user through the LLM step again, which
      // rewrites a valid config. Fail toward re-asking, never crashing.
    }
  }
  return {
    config: deps.configExists,
    llmKey,
    gmailClient:
      deps.hasSecret("gmail-client-id") &&
      deps.hasSecret("gmail-client-secret"),
    gmailTokens: deps.hasSecret("gmail-tokens"),
    agent: deps.agentPlistExists,
  };
}

export function registerSetupStatusCommand(program: Command): void {
  program
    .command("setup-status", { hidden: true })
    .description(
      "print setup progress as JSON (machine-facing; existence only, never values)",
    )
    .action(() => {
      const status = collectSetupStatus({
        configExists: existsSync(CONFIG_PATH),
        configText: () => readFileSync(CONFIG_PATH, "utf8"),
        hasSecret: (name) => !!getSecret(name),
        agentPlistExists: existsSync(PLIST_PATH),
      });
      console.log(JSON.stringify(status));
    });
}
