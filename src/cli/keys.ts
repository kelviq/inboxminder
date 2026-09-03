import * as p from "@clack/prompts";
import type { Command } from "commander";
import { secretFromStdinText } from "../config/headless.js";
import { setSecret } from "../secrets/keychain.js";
import { readStdinText } from "./stdin.js";

export function registerSetKeyCommand(program: Command): void {
  program
    .command("set-key <name>")
    .description(
      "Store a secret in the macOS Keychain (openai, anthropic, google, gmail-client-id, gmail-client-secret...)",
    )
    .option(
      "--stdin",
      "read the value from stdin instead of prompting (for GUIs/scripts; secrets must never be passed via argv)",
    )
    .action(async (name: string, opts: { stdin?: boolean }) => {
      if (opts.stdin) {
        // Machine-facing path (onboarding UI / scripts): plain lines on
        // purpose, no clack decoration.
        const value = secretFromStdinText(await readStdinText());
        if (!value) {
          console.error(`set-key --stdin: empty input; nothing stored`);
          process.exitCode = 1;
          return;
        }
        setSecret(name, value);
        console.log(`Stored "${name}" in Keychain.`);
        console.log(
          "If the daemon is running, restart it to pick up the rotated key: inboxminder agent install",
        );
        return;
      }
      const value = await p.password({ message: `Value for "${name}"` });
      if (p.isCancel(value)) return p.cancel("Aborted");
      setSecret(name, String(value));
      p.log.success(`Stored "${name}" in Keychain.`);
      p.log.message(
        "If the daemon is running, restart it to pick up the rotated key: inboxminder agent install",
      );
    });
}
