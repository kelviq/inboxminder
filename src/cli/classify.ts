import type { Command } from "commander";
import { loadConfig } from "../config/load.js";

export function registerClassifyCommand(program: Command): void {
  program
    .command("classify <messageId>")
    .description(
      "Classify one Gmail message id and print the verdict (nothing is labeled or archived)",
    )
    .action(async (messageId: string) => {
      const [{ mailProvider }, { classifyReplyWorthiness }] = await Promise.all(
        [import("../email/provider.js"), import("../engine/classify.js")],
      );
      const cfg = loadConfig();
      const msg = await mailProvider(cfg).getMessage(messageId);
      if (!msg) return console.error("Message not found");
      // Output stays raw console.log ON PURPOSE (deviation from the p.log
      // idiom): this command's output is the PAYLOAD — the tuning loop
      // pipes/copies it, and clack's bar prefixes would mangle it.
      const verdict = await classifyReplyWorthiness(cfg, msg);
      console.log(`reply:      ${verdict.reply}`);
      console.log(`confidence: ${verdict.confidence}`);
      if (verdict.category) console.log(`category:   ${verdict.category}`);
      if (verdict.reply) console.log(`important:  ${!!verdict.important}`);
      if (verdict.reason) console.log(`reason:     ${verdict.reason}`);
    });
}
