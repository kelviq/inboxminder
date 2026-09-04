import { z } from "zod";

/**
 * Triage categories — the fixed set the classifier may assign to
 * non-reply-worthy mail. Deliberately not configurable in v1 (five knobs
 * too many); label names derive from these in watcher.ts.
 */
export const TRIAGE_CATEGORIES = [
  "newsletter",
  "notification",
  "marketing",
  "cold-outreach",
  "fyi",
] as const;
export type TriageCategory = (typeof TRIAGE_CATEGORIES)[number];

export const ProviderSchema = z.enum([
  "openai",
  "anthropic",
  "google",
  "openai-compatible",
]);

/**
 * Gmail rejects user labels whose name collides (case-insensitively)
 * with a system label — labels.create returns an opaque 400 "Invalid
 * label name". Caught in the wild on 2026-09-04: the old default
 * "Important" could never be created on a fresh mailbox. Validate here
 * so a hand-configured collision fails loudly at config load instead.
 */
const GMAIL_RESERVED_LABELS = new Set([
  "inbox",
  "spam",
  "trash",
  "unread",
  "starred",
  "important",
  "sent",
  "draft",
  "drafts",
  "chat",
]);
const labelName = () =>
  z
    .string()
    .min(1)
    .refine((n) => !GMAIL_RESERVED_LABELS.has(n.trim().toLowerCase()), {
      message:
        "collides with a Gmail system label (Gmail rejects it); pick another name, e.g. Urgent instead of Important",
    });

export const ConfigSchema = z.object({
  llm: z
    .object({
      provider: ProviderSchema.default("anthropic"),
      model: z.string().default("claude-sonnet-5"),
      // baseUrl only used for openai-compatible (Groq, Ollama, LM Studio, vLLM...)
      baseUrl: z.string().url().optional(),
    })
    .prefault({}),
  email: z
    .object({
      provider: z.literal("gmail").default("gmail"),
      pollIntervalSec: z.number().int().min(10).default(45),
      // Senders skipped without a classifier call (address substring).
      skipSenders: z.array(z.string()).default(["mailer-daemon"]),
      // macOS notifications — fired ONLY for Important reply-worthy mail
      // and re-auth failures; subjects only, never body content.
      notifications: z.boolean().default(true),
      // Daily version check against GitHub releases (notify-only — the
      // daemon never updates itself). One request/day carrying no user
      // data; disclosed in the README. false disables entirely.
      updateCheck: z.boolean().default(true),
    })
    .prefault({}),
  // The gatekeeper itself: every email gets one classifier call; non-reply
  // mail gets a category label (Newsletter / Notification / Marketing /
  // Cold Outreach / FYI), urgent reply-worthy mail gets Important.
  // `archive` lists categories that ALSO get INBOX removed (skip-inbox,
  // never delete) — opt-in per category, label always applied in the same
  // call (audit trail).
  triage: z
    .object({
      enabled: z.boolean().default(true),
      archive: z.array(z.enum(TRIAGE_CATEGORIES)).default([]),
      // Free text appended to the cold-outreach criteria in the classify
      // prompt (e.g. what counts as a warm intro in your world).
      coldOutreachHint: z.string().max(500).default(""),
      // Label names per category — short by default; add a "/" prefix
      // (e.g. "Mail/Newsletter") to nest them in Gmail's sidebar.
      // TOML note: the hyphenated key needs quotes — "cold-outreach" = "…".
      labels: z
        .object({
          newsletter: labelName().default("Newsletter"),
          notification: labelName().default("Notification"),
          marketing: labelName().default("Marketing"),
          "cold-outreach": labelName().default("Cold Outreach"),
          fyi: labelName().default("FYI"),
          // "Important" collides with Gmail's system label; see above.
          important: labelName().default("Urgent"),
        })
        .prefault({}),
    })
    .prefault({}),
  // Thread-state labels: Pending when a reply-worthy email arrives,
  // Resolved when your own reply is observed, Pending again on the next
  // reply-worthy inbound. Write-only projection — labels are never read
  // back as state, so editing them by hand in Gmail is always safe.
  labels: z
    .object({
      enabled: z.boolean().default(true),
      pending: labelName().default("Pending"),
      resolved: labelName().default("Resolved"),
    })
    .prefault({}),
  // Per-sender steering rules, keyed by sender ADDRESS substring (display
  // names are untrusted — a sender naming themselves "Investor X" must not
  // trigger Investor X's rules). Rules steer the classifier only — never
  // actions.
  instructions: z
    .object({
      rules: z
        .array(
          z.object({
            match: z.string().min(1).max(200),
            note: z.string().min(1).max(2000),
          }),
        )
        .max(100)
        .default([]),
    })
    .prefault({}),
});

export type Config = z.infer<typeof ConfigSchema>;
