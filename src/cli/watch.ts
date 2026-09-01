import type { Command } from "commander";
import { loadConfig } from "../config/load.js";

export function registerWatchCommand(program: Command): void {
  program
    .command("watch")
    .description("Watch the inbox and create reply drafts automatically")
    .action(async () => {
      const { runWatcher } = await import("../email/watcher.js");
      await runWatcher(loadConfig());
    });
}
