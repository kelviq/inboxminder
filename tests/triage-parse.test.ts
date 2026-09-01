import { describe, expect, it } from "vitest";
import { buildClassifySystem, parseVerdict } from "../src/engine/classify.js";

describe("parseVerdict triage widening", () => {
  it("parses a valid category", () => {
    const v = parseVerdict(
      '{"reply": false, "category": "newsletter", "reason": "weekly digest"}',
    );
    expect(v.reply).toBe(false);
    expect(v.category).toBe("newsletter");
  });

  it("parses every member of the fixed set", () => {
    for (const c of [
      "newsletter",
      "notification",
      "marketing",
      "cold-outreach",
      "fyi",
    ]) {
      expect(
        parseVerdict(`{"reply": false, "category": "${c}", "reason": "x"}`)
          .category,
      ).toBe(c);
    }
  });

  it('"reply"/"other"/garbage categories mean no category', () => {
    expect(
      parseVerdict('{"reply": true, "category": "reply", "reason": "x"}')
        .category,
    ).toBeUndefined();
    expect(
      parseVerdict('{"reply": false, "category": "other", "reason": "x"}')
        .category,
    ).toBeUndefined();
    expect(
      parseVerdict('{"reply": false, "category": "Spam!!", "reason": "x"}')
        .category,
    ).toBeUndefined();
    expect(
      parseVerdict('{"reply": false, "reason": "x"}').category,
    ).toBeUndefined();
  });

  it("importance only on an explicit boolean true", () => {
    expect(
      parseVerdict('{"reply": true, "important": true, "reason": "x"}')
        .important,
    ).toBe(true);
    expect(
      parseVerdict('{"reply": true, "important": false, "reason": "x"}')
        .important,
    ).toBeUndefined();
    expect(
      parseVerdict('{"reply": true, "important": "yes", "reason": "x"}')
        .important,
    ).toBeUndefined();
    expect(
      parseVerdict('{"reply": true, "reason": "x"}').important,
    ).toBeUndefined();
  });

  it("fail-open paths carry no category and no importance", () => {
    const v = parseVerdict("total garbage");
    expect(v.reply).toBe(true);
    expect(v.category).toBeUndefined();
    expect(v.important).toBeUndefined();
    // The regex fallback path too.
    const fallback = parseVerdict('reply": false — this is a receipt');
    expect(fallback.category).toBeUndefined();
  });

  it("the base verdict shape is untouched", () => {
    expect(
      parseVerdict('{"reply": true, "reason": "direct question"}'),
    ).toEqual({ reply: true, confidence: "sure", reason: "direct question" });
  });
});

describe("buildClassifySystem triage block", () => {
  it("no triage = the exact historical prompt (no category contract)", () => {
    const system = buildClassifySystem([]);
    expect(system).not.toContain("category");
    expect(system).not.toContain("important");
    expect(system).toContain(
      'Output exactly one line of JSON: {"reply": true|false, "confidence": "sure"|"unsure", "reason": "<short reason>"}',
    );
  });

  it("with triage: categories + importance replace the output line", () => {
    const system = buildClassifySystem([], { coldOutreachHint: "" });
    expect(system).toContain('"newsletter"');
    expect(system).toContain('"cold-outreach"');
    expect(system).toContain('"important": true|false');
    // Exactly ONE output contract — the widened one.
    expect(system.match(/Output exactly one line of JSON/g)).toHaveLength(1);
    expect(system).toContain('"category": "<category>"');
  });

  it("coldOutreachHint joins the cold-outreach criteria", () => {
    const system = buildClassifySystem([], {
      coldOutreachHint: "intros from Jane are always warm",
    });
    expect(system).toContain("intros from Jane are always warm");
  });

  it("sender steering still appends after the triage block", () => {
    const system = buildClassifySystem(["Never draft for this domain."], {
      coldOutreachHint: "",
    });
    expect(system).toContain("Never draft for this domain.");
  });
});
