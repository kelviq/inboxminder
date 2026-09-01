// Builds the config.toml text written by `inboxminder init`. Kept separate
// from the CLI so it can be unit tested without driving the interactive
// prompts.

export interface RenderConfigTomlOptions {
  llmProvider: string;
  model: string;
}

export function renderConfigToml(opts: RenderConfigTomlOptions): string {
  const { llmProvider, model } = opts;
  return [
    "[llm]",
    `provider = ${JSON.stringify(llmProvider)}`,
    `model = ${JSON.stringify(model)}`,
    "",
    "[email]",
    "pollIntervalSec = 45",
    "",
    "[triage]",
    "enabled = true",
    "# categories that additionally skip the inbox (label stays as audit trail):",
    '# archive = ["newsletter", "marketing"]',
    'coldOutreachHint = ""',
    "",
    "[labels]",
    "enabled = true",
  ].join("\n");
}
