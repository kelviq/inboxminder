// Headless setup surface: the pure pieces behind `init --answers-stdin`
// and `set-key --stdin`, kept out of the CLI files so scripts and tests
// never have to drive prompts. Secrets are deliberately NOT part of the
// answers document — they travel one at a time over stdin to
// `set-key --stdin`, so no JSON blob holding credentials ever exists.

import { z } from "zod";
import type { RenderConfigTomlOptions } from "./render.js";

/**
 * The answers a script provides in place of the interactive prompts.
 * Strict on purpose: an unknown key is a contract bug worth failing
 * loudly on, not a field to silently drop.
 */
export const AnswersSchema = z
  .object({
    llmProvider: z.enum(["openai", "anthropic", "google", "openai-compatible"]),
    model: z.string().min(1),
    // openai-compatible only; ConfigSchema re-validates the written TOML,
    // so a baseUrl on another provider is harmless surplus there but is
    // rejected here to keep the contract honest.
    baseUrl: z.string().url().optional(),
  })
  .strict()
  .refine((a) => a.llmProvider === "openai-compatible" || !a.baseUrl, {
    message: "baseUrl is only valid with llmProvider openai-compatible",
  });

export type Answers = z.infer<typeof AnswersSchema>;

/** Validated answers → renderConfigToml input. */
export function answersToTomlInput(raw: unknown): RenderConfigTomlOptions {
  const a = AnswersSchema.parse(raw);
  return { llmProvider: a.llmProvider, model: a.model, baseUrl: a.baseUrl };
}

/**
 * First line of a stdin payload — secrets are single-line values; the
 * trailing newline an `echo` or pipe appends is not part of the secret.
 */
export function secretFromStdinText(raw: string): string {
  return raw.split(/\r?\n/)[0] ?? "";
}
