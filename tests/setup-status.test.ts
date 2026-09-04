import { describe, expect, it } from "vitest";
import { collectSetupStatus } from "../src/cli/setup-status.js";

const validConfig = `
[llm]
provider = "anthropic"
model = "claude-sonnet-5"
`;

describe("collectSetupStatus (plan 053 wizard re-entrancy source)", () => {
  it("fresh Mac: everything false", () => {
    const s = collectSetupStatus({
      configExists: false,
      configText: () => "",
      hasSecret: () => false,
      agentPlistExists: false,
    });
    expect(s).toEqual({
      config: false,
      llmKey: false,
      gmailClient: false,
      gmailTokens: false,
      agent: false,
    });
  });

  it("llmKey checks the CONFIGURED provider's secret, not any secret", () => {
    const s = collectSetupStatus({
      configExists: true,
      configText: () => validConfig,
      hasSecret: (n) => n === "openai", // wrong provider's key stored
      agentPlistExists: false,
    });
    expect(s.config).toBe(true);
    expect(s.llmKey).toBe(false);
  });

  it("complete install: everything true", () => {
    const s = collectSetupStatus({
      configExists: true,
      configText: () => validConfig,
      hasSecret: () => true,
      agentPlistExists: true,
    });
    expect(s).toEqual({
      config: true,
      llmKey: true,
      gmailClient: true,
      gmailTokens: true,
      agent: true,
    });
  });

  it("gmailClient needs BOTH id and secret", () => {
    const s = collectSetupStatus({
      configExists: false,
      configText: () => "",
      hasSecret: (n) => n === "gmail-client-id",
      agentPlistExists: false,
    });
    expect(s.gmailClient).toBe(false);
  });

  it("unparsable config fails toward re-asking (config true, llmKey false), never throws", () => {
    const s = collectSetupStatus({
      configExists: true,
      configText: () => "not [valid toml ===",
      hasSecret: () => true,
      agentPlistExists: false,
    });
    expect(s.config).toBe(true);
    expect(s.llmKey).toBe(false);
  });
});
