import { parse } from "smol-toml";
import { describe, expect, it } from "vitest";
import {
  AnswersSchema,
  answersToTomlInput,
  secretFromStdinText,
} from "../src/config/headless.js";
import { renderConfigToml } from "../src/config/render.js";
import { ConfigSchema } from "../src/config/schema.js";

describe("headless answers → config.toml", () => {
  it("answers render a TOML that passes the real ConfigSchema", () => {
    const toml = renderConfigToml(
      answersToTomlInput({
        llmProvider: "anthropic",
        model: "claude-sonnet-5",
      }),
    );
    const cfg = ConfigSchema.parse(parse(toml));
    expect(cfg.llm.provider).toBe("anthropic");
    expect(cfg.llm.model).toBe("claude-sonnet-5");
    // Product defaults ride along.
    expect(cfg.triage.enabled).toBe(true);
    expect(cfg.labels.enabled).toBe(true);
  });

  it("is byte-equivalent to the interactive flow for the same choices", () => {
    const headless = renderConfigToml(
      answersToTomlInput({ llmProvider: "anthropic", model: "m" }),
    );
    const interactive = renderConfigToml({
      llmProvider: "anthropic",
      model: "m",
    });
    expect(headless).toBe(interactive);
  });

  it("rejects unknown providers, wrong shapes, and unknown keys (strict contract)", () => {
    expect(() =>
      answersToTomlInput({ llmProvider: "grok", model: "m" }),
    ).toThrow();
    expect(() =>
      answersToTomlInput({ llmProvider: "openai", model: "m", apiKey: "sk-x" }),
    ).toThrow(); // secrets do NOT belong in the answers document
    expect(() => answersToTomlInput({ llmProvider: "openai" })).toThrow(); // model required
    expect(AnswersSchema.safeParse({}).success).toBe(false);
  });
});

describe("secretFromStdinText", () => {
  it("takes the first line and strips the pipe-appended newline", () => {
    expect(secretFromStdinText("sk-abc123\n")).toBe("sk-abc123");
    expect(secretFromStdinText("sk-abc123\r\n")).toBe("sk-abc123");
    expect(secretFromStdinText("sk-abc123")).toBe("sk-abc123");
    expect(secretFromStdinText("first\nsecond\n")).toBe("first");
  });

  it("empty and newline-only input yield the empty string (caller rejects)", () => {
    expect(secretFromStdinText("")).toBe("");
    expect(secretFromStdinText("\n")).toBe("");
  });

  it("preserves interior/leading characters exactly (no trimming beyond the newline)", () => {
    expect(secretFromStdinText(" spaced secret \n")).toBe(" spaced secret ");
  });
});
