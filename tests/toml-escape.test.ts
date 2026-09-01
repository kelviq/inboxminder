import { parse } from "smol-toml";
import { describe, expect, it } from "vitest";
import { renderConfigToml } from "../src/config/render.js";
import { ConfigSchema } from "../src/config/schema.js";

describe("renderConfigToml", () => {
  it("round-trips model/provider strings with embedded quotes", () => {
    const toml = renderConfigToml({
      llmProvider: "anthropic",
      model: 'weird "model" name',
    });
    const parsed = parse(toml) as { llm: { model: string } };
    expect(parsed.llm.model).toBe('weird "model" name');
  });

  it("renders a config the schema accepts, with triage + labels on", () => {
    const toml = renderConfigToml({
      llmProvider: "openai",
      model: "gpt-5",
    });
    const cfg = ConfigSchema.parse(parse(toml));
    expect(cfg.llm.provider).toBe("openai");
    expect(cfg.triage.enabled).toBe(true);
    expect(cfg.triage.archive).toEqual([]);
    expect(cfg.labels.enabled).toBe(true);
  });
});
