import { parse, stringify } from "smol-toml";
import { z } from "zod";
import { type Config, ConfigSchema, TRIAGE_CATEGORIES } from "./schema.js";

/*
 * Settings editor surface: read/update config.toml through a validated
 * funnel — the knobs the Preferences window edits. The GUI never touches
 * the TOML file directly. Per-section key merge: keys outside the
 * document inside touched sections survive a set untouched; the whole
 * result is validated with ConfigSchema before writing.
 *
 * Bounds below restate ConfigSchema's for friendly early errors, but the
 * ConfigSchema.parse before write is the authority — drift between the
 * two can reject early or late, never write an invalid config.
 */

export const SettingsSchema = z.object({
  llm: z.object({
    // Safe to expose here: there is no index keyed on the model — a
    // provider/model change only affects future classifications. The new
    // provider's API key still needs `set-key` (the UI says so).
    provider: z.enum(["openai", "anthropic", "google", "openai-compatible"]),
    model: z.string().min(1),
  }),
  email: z.object({
    pollIntervalSec: z.number().int().min(10),
    notifications: z.boolean(),
    updateCheck: z.boolean(),
    skipSenders: z.array(z.string()),
  }),
  triage: z.object({
    enabled: z.boolean(),
    archive: z.array(z.enum(TRIAGE_CATEGORIES)),
    coldOutreachHint: z.string().max(500),
    labels: z.object({
      newsletter: z.string().min(1),
      notification: z.string().min(1),
      marketing: z.string().min(1),
      "cold-outreach": z.string().min(1),
      fyi: z.string().min(1),
      important: z.string().min(1),
    }),
  }),
  labels: z.object({
    enabled: z.boolean(),
    pending: z.string().min(1),
    resolved: z.string().min(1),
  }),
  // Whole-array replacement (rules are a table, not a key merge).
  instructions: z.object({
    rules: z.array(
      z.object({
        match: z.string().min(1).max(200),
        note: z.string().min(1).max(2000),
      }),
    ),
  }),
});

export type SettingsDoc = z.infer<typeof SettingsSchema>;

export function settingsFromConfig(cfg: Config): SettingsDoc {
  return {
    llm: { provider: cfg.llm.provider, model: cfg.llm.model },
    email: {
      pollIntervalSec: cfg.email.pollIntervalSec,
      notifications: cfg.email.notifications,
      updateCheck: cfg.email.updateCheck,
      skipSenders: cfg.email.skipSenders,
    },
    triage: {
      enabled: cfg.triage.enabled,
      archive: cfg.triage.archive,
      coldOutreachHint: cfg.triage.coldOutreachHint,
      labels: cfg.triage.labels,
    },
    labels: {
      enabled: cfg.labels.enabled,
      pending: cfg.labels.pending,
      resolved: cfg.labels.resolved,
    },
    instructions: { rules: cfg.instructions.rules },
  };
}

/**
 * Per-section merge of ONLY the document's keys onto raw config.toml —
 * excluded keys inside those sections (e.g. llm.baseUrl) and untouched
 * sections pass through byte-equivalent at the parsed level.
 * `instructions.rules` replaces wholesale (it's a table). Validates the
 * WHOLE result with ConfigSchema before returning.
 */
export function applySettings(rawToml: string, doc: SettingsDoc): string {
  const parsed = parse(rawToml) as Record<string, unknown>;
  const merge = (section: string, values: Record<string, unknown>) => {
    parsed[section] = {
      ...((parsed[section] as Record<string, unknown> | undefined) ?? {}),
      ...values,
    };
  };
  merge("llm", doc.llm);
  merge("email", doc.email);
  merge("triage", doc.triage);
  merge("labels", doc.labels);
  parsed.instructions = { rules: doc.instructions.rules };
  ConfigSchema.parse(parsed); // never write TOML the loader would reject
  return `${stringify(parsed)}\n`;
}
