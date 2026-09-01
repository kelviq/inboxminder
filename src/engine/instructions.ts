/*
 * Per-sender steering instructions: policy notes keyed by sender address
 * ("always important", "never worth a reply", "warm intro contact"). They
 * steer the classifier only — never actions (that boundary is
 * load-bearing).
 */

export interface InstructionRule {
  match: string;
  note: string;
}

/**
 * The address inside a From header. Duplicated from watcher.ts's
 * fromAddress on purpose (engine must not import the watcher — cycle):
 * display names are UNTRUSTED decoration — a sender writing
 * "Investor X" into their display name must not be able to trigger
 * Investor X's rules. Matching is address-substring only.
 */
export function extractAddress(fromHeader: string): string {
  return (fromHeader.match(/<([^>]+)>/)?.[1] ?? fromHeader)
    .trim()
    .toLowerCase();
}

/** Notes of every rule whose match is a substring of the sender ADDRESS. */
export function matchInstructions(
  rules: InstructionRule[],
  fromHeader: string,
): string[] {
  const addr = extractAddress(fromHeader);
  if (!addr) return [];
  return rules
    .filter((r) => addr.includes(r.match.trim().toLowerCase()))
    .map((r) => r.note);
}

/**
 * Classifier steering lines: appended to the classify system
 * prompt so "never draft for this domain" works at the skip layer. The
 * fail-OPEN posture is untouched — rules bias the verdict, errors still
 * draft.
 */
export function classifySteering(senderNotes: string[]): string {
  if (!senderNotes.length) return "";
  return [
    "",
    "The user's standing rules for THIS sender (apply them when judging whether a reply is expected):",
    ...senderNotes.map((n) => `- ${n}`),
  ].join("\n");
}
