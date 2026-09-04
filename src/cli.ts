#!/usr/bin/env node
// MUST stay first: normalizes --profile into INBOXMINDER_PROFILE before
// any module derives profile-dependent constants.
import "./config/profile-boot.js";
import { Command } from "commander";
import { registerAgentCommand } from "./cli/agent.js";
import { registerAuthCommand } from "./cli/auth.js";
import { registerClassifyCommand } from "./cli/classify.js";
import { registerConfigCommand } from "./cli/config.js";
import { registerInitCommand } from "./cli/init.js";
import { registerSetKeyCommand } from "./cli/keys.js";
import { registerProfilesCommand } from "./cli/profiles.js";
import { registerSetupStatusCommand } from "./cli/setup-status.js";
import { registerUpCommand } from "./cli/up.js";
import { registerWatchCommand } from "./cli/watch.js";
import { VERSION } from "./version.js";

/*
 * Thin wiring only: every command lives in its own file under src/cli/ —
 * that directory is the only LAYER that talks to the terminal. New
 * commands get their own file; reviewers should reject additions here.
 *
 * Output idiom: clack `p.log.*` for human-facing lines, raw console for
 * machine-facing paths (--stdin, the `classify` payload) and this
 * backstop. Heavy modules stay dynamically imported inside actions —
 * `agent status`/`--version` must not pay for Gmail or the LLM SDK.
 */
const program = new Command();
program
  .name("inboxminder")
  .description(
    "Open-source agent gatekeeper for your inbox; every email read locally, scored, and triaged",
  )
  // Consumed by profile-boot's argv scan before commander runs; declared
  // here so help is honest. Place it BEFORE the command name.
  .option(
    "--profile <name>",
    "run against an isolated profile (own config, secrets, agent)",
  )
  .version(VERSION);

registerInitCommand(program);
registerSetKeyCommand(program);
registerAuthCommand(program);
registerUpCommand(program);
registerWatchCommand(program);
registerAgentCommand(program);
registerClassifyCommand(program);
registerProfilesCommand(program);
registerConfigCommand(program);
registerSetupStatusCommand(program);

program.parseAsync().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
