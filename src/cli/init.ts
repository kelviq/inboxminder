import { existsSync } from "node:fs";
import * as p from "@clack/prompts";
import type { Command } from "commander";
import { parse } from "smol-toml";
import { answersToTomlInput } from "../config/headless.js";
import { CONFIG_PATH, saveConfigToml } from "../config/load.js";
import { renderConfigToml } from "../config/render.js";
import { ConfigSchema } from "../config/schema.js";
import { getSecret, setSecret } from "../secrets/keychain.js";
import { goLive } from "./golive.js";
import { readStdinText } from "./stdin.js";

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description(
      "Interactive setup: pick your LLM, write config, store API keys",
    )
    .option(
      "--answers-stdin",
      "non-interactive: read an answers JSON document from stdin and write config.toml (secrets excluded; store those via set-key --stdin)",
    )
    .option(
      "--force",
      "with --answers-stdin: overwrite an existing config.toml",
    )
    .action(async (opts: { answersStdin?: boolean; force?: boolean }) => {
      if (opts.answersStdin) {
        // Machine-facing path (scripts): plain lines on purpose, no clack
        // decoration.
        if (existsSync(CONFIG_PATH) && !opts.force) {
          console.error(
            `${CONFIG_PATH} already exists; pass --force to overwrite (Keychain secrets are kept either way)`,
          );
          process.exitCode = 1;
          return;
        }
        let tomlText: string;
        try {
          const answers: unknown = JSON.parse(await readStdinText());
          tomlText = renderConfigToml(answersToTomlInput(answers));
          // Same validate-before-write funnel as the interactive flow below.
          ConfigSchema.parse(parse(tomlText));
        } catch (err) {
          console.error(
            `init --answers-stdin: invalid answers; nothing written:\n${err instanceof Error ? err.message : String(err)}`,
          );
          process.exitCode = 1;
          return;
        }
        saveConfigToml(tomlText);
        console.log(`Config written to ${CONFIG_PATH}`);
        return;
      }
      p.intro("inboxminder setup");
      if (existsSync(CONFIG_PATH)) {
        const overwrite = await p.confirm({
          message: `${CONFIG_PATH} already exists; overwrite it? (Keychain secrets are kept either way)`,
          initialValue: false,
        });
        if (p.isCancel(overwrite) || !overwrite) return p.cancel("Aborted");
      }

      // --- LLM ---
      const llmProvider = await p.select({
        message: "Which LLM provider should read and score your mail?",
        options: [
          { value: "anthropic", label: "Anthropic" },
          { value: "openai", label: "OpenAI" },
          { value: "google", label: "Google" },
          {
            value: "openai-compatible",
            label:
              "OpenAI-compatible (Groq, Ollama, LM Studio...; fully local possible)",
          },
        ],
      });
      if (p.isCancel(llmProvider)) return p.cancel("Aborted");
      const model = await p.text({
        message: "Model id",
        placeholder: "e.g. claude-sonnet-5",
      });
      if (p.isCancel(model)) return p.cancel("Aborted");
      const key = await p.password({
        message: `API key for ${String(llmProvider)} (stored in macOS Keychain)`,
      });
      if (p.isCancel(key)) return p.cancel("Aborted");
      setSecret(String(llmProvider), String(key));

      // --- Gmail OAuth client (optional here; can be done later via set-key) ---
      const gmailNow = await p.confirm({
        message:
          "Set up the Gmail OAuth client now? (Needs a client ID + secret from Google Cloud Console; see README. You can skip and run `inboxminder set-key` later.)",
        initialValue: true,
      });
      let gmailDone = false;
      if (!p.isCancel(gmailNow) && gmailNow) {
        const cid = await p.password({ message: "Gmail OAuth client ID" });
        const csec = await p.password({
          message: "Gmail OAuth client secret",
        });
        if (!p.isCancel(cid) && cid && !p.isCancel(csec) && csec) {
          setSecret("gmail-client-id", String(cid));
          setSecret("gmail-client-secret", String(csec));
          gmailDone = true;
        }
      }

      const tomlText = renderConfigToml({
        llmProvider: String(llmProvider),
        model: String(model),
      });
      try {
        ConfigSchema.parse(parse(tomlText));
      } catch (err) {
        p.log.error(
          `Generated config failed validation; nothing was written:\n${err instanceof Error ? err.message : String(err)}`,
        );
        return;
      }
      saveConfigToml(tomlText);
      p.log.success(`Config written to ${CONFIG_PATH}`);

      const haveGmailClient =
        gmailDone ||
        (!!getSecret("gmail-client-id") && !!getSecret("gmail-client-secret"));
      if (!haveGmailClient) {
        p.outro(
          "Next: inboxminder set-key gmail-client-id + gmail-client-secret (see README for the Google Cloud steps), then inboxminder up",
        );
        return;
      }
      const live = await p.confirm({
        message:
          "Go live now? (authorize Gmail → install the background agent)",
        initialValue: true,
      });
      if (p.isCancel(live) || !live) {
        p.outro("Whenever you're ready: inboxminder up");
        return;
      }
      await goLive();
      p.outro("All set.");
    });
}
