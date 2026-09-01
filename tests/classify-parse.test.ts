import { describe, expect, it } from "vitest";
import { parseVerdict } from "../src/engine/classify.js";

describe("parseVerdict", () => {
  it("parses clean JSON verdicts", () => {
    expect(
      parseVerdict('{"reply": true, "reason": "direct question"}'),
    ).toEqual({
      reply: true,
      confidence: "sure", // absent confidence defaults to sure
      reason: "direct question",
    });
    expect(parseVerdict('{"reply": false, "reason": "receipt"}')).toEqual({
      reply: false,
      confidence: "sure",
      reason: "receipt",
    });
  });

  it("confidence: only an explicit 'unsure' is unsure", () => {
    expect(
      parseVerdict('{"reply": true, "confidence": "unsure", "reason": "x"}')
        .confidence,
    ).toBe("unsure");
    expect(
      parseVerdict('{"reply": true, "confidence": "maybe?", "reason": "x"}')
        .confidence,
    ).toBe("sure");
    // Every fail-open path is sure — coverage gates can never skip on it.
    expect(parseVerdict("garbage").confidence).toBe("sure");
  });

  it("extracts JSON wrapped in prose or code fences", () => {
    const fenced =
      'Sure! Here is my answer:\n```json\n{"reply": false, "reason": "CI notification"}\n```';
    expect(parseVerdict(fenced).reply).toBe(false);
  });

  it("falls back to regex when JSON is mangled", () => {
    expect(parseVerdict('reply": false — this is a receipt').reply).toBe(false);
  });

  it("fails open to reply=true on garbage", () => {
    expect(parseVerdict("I am not sure what you mean").reply).toBe(true);
    expect(parseVerdict("").reply).toBe(true);
    expect(parseVerdict('{"verdict": "skip"}').reply).toBe(true);
  });
});
