import { generateText } from "ai";
import type { Config, TriageCategory } from "../config/schema.js";
import { TRIAGE_CATEGORIES } from "../config/schema.js";
import type { InboundMessage } from "../email/gmail.js";
import { languageModel } from "../llm/provider.js";
import { log } from "../log.js";
import { classifySteering, matchInstructions } from "./instructions.js";

export interface ReplyVerdict {
  reply: boolean;
  /**
   * "unsure" only when the model EXPLICITLY says so — every
   * fail-open path reports "sure" so coverage=confident-only can never
   * skip on an error or an unparseable verdict.
   */
  confidence: "sure" | "unsure";
  reason: string;
  /**
   * Triage category — set only when the model emitted a valid
   * member of the fixed set. Absent/invalid = no category: an unparseable
   * verdict drafts and labels nothing.
   */
  category?: TriageCategory;
  /**
   * Importance tier — true only when the model explicitly said
   * so for reply-worthy mail. Parse failure = not important, never the
   * other way.
   */
  important?: boolean;
}

/** Triage additions to the classify call — cfg.triage when enabled. */
export interface TriageOpts {
  coldOutreachHint: string;
}

const BASE_LINES = [
  "You decide whether an incoming email expects a reply from its recipient.",
  "Answer NO for: FYI-only messages, automated notifications (CI, bots, monitoring alerts),",
  "receipts and order/payment confirmations, calendar invite responses (accepted/declined),",
  "shipping updates, OTP/verification codes, out-of-office autoreplies, mass marketing.",
  "Answer YES for anything where a human is asking, requesting, introducing, or awaiting the",
  "recipient; when unsure, answer YES (an unnecessary draft is cheaper than a missed reply).",
  'Also report confidence: "sure" normally, "unsure" only when the call is genuinely borderline.',
];

const BASE_OUTPUT =
  'Output exactly one line of JSON: {"reply": true|false, "confidence": "sure"|"unsure", "reason": "<short reason>"}';

function triageLines(triage: TriageOpts): string[] {
  const hint = triage.coldOutreachHint.trim();
  return [
    "Also assign the email a triage category:",
    '- "newsletter": recurring editorial content the recipient subscribed to',
    '- "notification": an automated system or service message (CI, bots, receipts, alerts, confirmations)',
    '- "marketing": promotional mail selling something to the recipient',
    `- "cold-outreach": an unsolicited pitch, sales, recruiting, or link-building approach from a stranger${
      hint ? ` (${hint})` : ""
    }`,
    '- "fyi": a human sharing information that needs no action',
    '- "reply": a reply is expected (use with reply=true)',
    '- "other": none of the above',
    'For reply-worthy mail also report "important": true only when it is urgent, blocking, or time-sensitive; otherwise false.',
    'Output exactly one line of JSON: {"reply": true|false, "confidence": "sure"|"unsure", "category": "<category>", "important": true|false, "reason": "<short reason>"}',
  ];
}

/**
 * Exported for tests — no notes and no triage = the exact historical
 * system prompt. The triage block replaces the output line so
 * the model is never given two conflicting output contracts.
 */
export function buildClassifySystem(
  senderNotes: string[],
  triage?: TriageOpts,
): string {
  const lines = triage
    ? [...BASE_LINES, ...triageLines(triage)]
    : [...BASE_LINES, BASE_OUTPUT];
  return lines.join("\n") + classifySteering(senderNotes);
}

/**
 * Lenient parse of the model's verdict. Malformed output fails open to
 * reply=true — a junk draft is recoverable, a silently skipped email is not.
 */
export function parseVerdict(text: string): ReplyVerdict {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]) as Partial<ReplyVerdict>;
      if (typeof parsed.reply === "boolean") {
        const verdict: ReplyVerdict = {
          reply: parsed.reply,
          // Absent/invalid confidence defaults to "sure" — only an
          // explicit "unsure" can ever trigger a coverage skip.
          confidence: parsed.confidence === "unsure" ? "unsure" : "sure",
          reason: String(parsed.reason ?? ""),
        };
        // Category only when it's a valid member of the fixed set —
        // "reply"/"other"/garbage all mean "no category label".
        if (
          (TRIAGE_CATEGORIES as readonly string[]).includes(
            parsed.category as string,
          )
        )
          verdict.category = parsed.category as TriageCategory;
        // Importance only on an explicit boolean true.
        if (parsed.important === true) verdict.important = true;
        return verdict;
      }
    }
  } catch {
    // fall through
  }
  if (/reply["']?\s*[:=]\s*false/i.test(text)) {
    return {
      reply: false,
      confidence: "sure",
      reason: "unparsed model output",
    };
  }
  return {
    reply: true,
    confidence: "sure",
    reason: "unparseable verdict; failing open",
  };
}

/** Cheap pre-draft gate: does this email warrant a reply at all? */
export async function classifyReplyWorthiness(
  cfg: Config,
  msg: InboundMessage,
): Promise<ReplyVerdict> {
  const triageOn = !!cfg.triage?.enabled;
  try {
    const { text } = await generateText({
      model: languageModel(cfg),
      system: buildClassifySystem(
        matchInstructions(cfg.instructions.rules, msg.from),
        triageOn
          ? { coldOutreachHint: cfg.triage.coldOutreachHint }
          : undefined,
      ),
      prompt: [
        `From: ${msg.from}`,
        `Subject: ${msg.subject}`,
        "",
        msg.bodyText.slice(0, 2000),
      ].join("\n"),
      // The triage-widened JSON line is longer — a truncated verdict would
      // fail open and silently lose the category, so give it headroom.
      maxOutputTokens: triageOn ? 220 : 150,
      // No default timeout on generateText — an unbounded await here is
      // exactly the class of bug that froze the watcher (see gmail.ts).
      abortSignal: AbortSignal.timeout(60_000),
    });
    return parseVerdict(text);
  } catch (err) {
    log.warn({ err }, "classification failed; failing open to draft");
    return {
      reply: true,
      confidence: "sure",
      reason: "classifier error; failing open",
    };
  }
}
