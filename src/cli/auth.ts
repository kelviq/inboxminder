import type { Command } from "commander";
import { loadConfig } from "../config/load.js";
import { ConfigSchema } from "../config/schema.js";

export function registerAuthCommand(program: Command): void {
  program
    .command("auth")
    .description("Authorize Gmail via browser OAuth")
    .action(async () => {
      // auth is the daemon's documented re-auth RECOVERY path — a broken
      // config.toml must not block it (same posture as `agent status`).
      // Defaults resolve to the gmail provider, matching pre-036 behavior.
      let cfg: ReturnType<typeof loadConfig>;
      try {
        cfg = loadConfig();
      } catch {
        cfg = ConfigSchema.parse({});
      }
      const { mailProvider } = await import("../email/provider.js");
      await mailProvider(cfg).setup();
    });
}
