import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { Config } from "../config/schema.js";
import { getSecret, requireSecret } from "../secrets/keychain.js";

// NOTE: written against AI SDK v5. If APIs drift, this is the only file to touch.

// Model memoization: constructing a provider costs a factory build + native
// Keychain read(s) on EVERY classify call. Cache per
// (provider, model, baseUrl) for the process lifetime. Deliberate
// trade-off: a rotated API key needs a daemon restart to be picked up —
// `set-key` says so in its output.
const models = new Map<string, unknown>();
function memoized<T>(key: string, make: () => T): T {
  if (!models.has(key)) models.set(key, make());
  return models.get(key) as T;
}

export function languageModel(cfg: Config) {
  const { provider, model, baseUrl } = cfg.llm;
  return memoized(`llm:${provider}:${model}:${baseUrl ?? ""}`, () =>
    buildLanguageModel(cfg),
  );
}

function buildLanguageModel(cfg: Config) {
  const { provider, model, baseUrl } = cfg.llm;
  switch (provider) {
    case "openai":
      return createOpenAI({ apiKey: requireSecret("openai") })(model);
    case "anthropic":
      return createAnthropic({ apiKey: requireSecret("anthropic") })(model);
    case "google":
      return createGoogleGenerativeAI({ apiKey: requireSecret("google") })(
        model,
      );
    case "openai-compatible":
      return createOpenAICompatible({
        name: "custom",
        baseURL: baseUrl ?? "http://localhost:11434/v1",
        apiKey: getSecret("custom") ?? "not-needed",
      })(model);
  }
}
