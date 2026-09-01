import { describe, expect, it } from "vitest";
import { ConfigSchema } from "../src/config/schema.js";
import { buildClassifySystem } from "../src/engine/classify.js";
import {
  classifySteering,
  extractAddress,
  matchInstructions,
} from "../src/engine/instructions.js";

describe("[instructions] config", () => {
  it("absent section = no rules", () => {
    expect(ConfigSchema.parse({}).instructions).toEqual({ rules: [] });
  });

  it("bounds hold", () => {
    expect(() =>
      ConfigSchema.parse({
        instructions: { rules: [{ match: "", note: "x" }] },
      }),
    ).toThrow();
    expect(() =>
      ConfigSchema.parse({
        instructions: { rules: [{ match: "x", note: "" }] },
      }),
    ).toThrow();
  });
});

describe("matchInstructions (address-only — untrusted-display-name rule)", () => {
  const rules = [
    { match: "@bigfund.com", note: "Be brief and concrete." },
    { match: "billing@", note: "Point at the pricing docs." },
    { match: "jo@partner.io", note: "CC-mention the cofounder." },
  ];

  it("matches address and domain substrings, case-insensitively", () => {
    expect(matchInstructions(rules, "Ana Lee <ana@BIGFUND.com>")).toEqual([
      "Be brief and concrete.",
    ]);
    expect(matchInstructions(rules, "billing@acme.dev")).toEqual([
      "Point at the pricing docs.",
    ]);
  });

  it("multiple matches apply in rule order", () => {
    expect(
      matchInstructions(
        [...rules, { match: "bigfund", note: "Second rule." }],
        "ana@bigfund.com",
      ),
    ).toEqual(["Be brief and concrete.", "Second rule."]);
  });

  it("display names can NEVER trigger a rule (spoof guard)", () => {
    expect(
      matchInstructions(rules, '"jo@partner.io via BigFund" <rando@evil.com>'),
    ).toEqual([]);
    expect(extractAddress('"billing@ trick" <x@y.com>')).toBe("x@y.com");
  });

  it("no rules / no match / empty from — empty result", () => {
    expect(matchInstructions([], "a@b.c")).toEqual([]);
    expect(matchInstructions(rules, "someone@else.org")).toEqual([]);
    expect(matchInstructions(rules, "")).toEqual([]);
  });
});

describe("classifier steering", () => {
  it("no notes = the exact historical system prompt", () => {
    expect(classifySteering([])).toBe("");
    expect(buildClassifySystem([])).not.toContain("standing rules");
  });

  it("notes append as labeled rules without touching the fail-open text", () => {
    const system = buildClassifySystem(["Never draft for this domain."]);
    expect(system).toContain("standing rules for THIS sender");
    expect(system).toContain("- Never draft for this domain.");
    expect(system).toContain("when unsure, answer YES");
  });
});
