import { parse } from "smol-toml";
import { describe, expect, it } from "vitest";
import { ConfigSchema } from "../src/config/schema.js";
import {
  applySettings,
  SettingsSchema,
  settingsFromConfig,
} from "../src/config/settings.js";

const RAW = `[llm]
provider = "anthropic"
model = "claude-sonnet-5"
baseUrl = "http://localhost:11434/v1"

[email]
pollIntervalSec = 45

[triage]
enabled = true
coldOutreachHint = ""
`;

const doc = () => settingsFromConfig(ConfigSchema.parse(parse(RAW)));

describe("settingsFromConfig", () => {
  it("projects the full editable surface with defaults filled", () => {
    expect(doc()).toEqual({
      llm: { provider: "anthropic", model: "claude-sonnet-5" },
      email: {
        pollIntervalSec: 45,
        notifications: true,
        skipSenders: ["mailer-daemon"],
      },
      triage: { enabled: true, archive: [], coldOutreachHint: "" },
      labels: {
        enabled: true,
        pending: "InboxMinder/Pending",
        resolved: "InboxMinder/Resolved",
      },
      instructions: { rules: [] },
    });
  });

  it("round-trips through SettingsSchema", () => {
    expect(SettingsSchema.parse(doc())).toEqual(doc());
  });
});

describe("applySettings", () => {
  it("merges edited keys and preserves excluded keys in touched sections", () => {
    const d = doc();
    d.triage.archive = ["newsletter", "marketing"];
    d.triage.coldOutreachHint = "friends of the fund are warm";
    d.email.pollIntervalSec = 90;
    const out = applySettings(RAW, d);
    const parsed = ConfigSchema.parse(parse(out));
    expect(parsed.triage.archive).toEqual(["newsletter", "marketing"]);
    expect(parsed.triage.coldOutreachHint).toBe("friends of the fund are warm");
    expect(parsed.email.pollIntervalSec).toBe(90);
    // llm.baseUrl is NOT on the settings surface — it must survive.
    expect(parsed.llm.baseUrl).toBe("http://localhost:11434/v1");
  });

  it("replaces the rules table wholesale", () => {
    const d = doc();
    d.instructions.rules = [
      { match: "@vip.example", note: "Always important." },
    ];
    const first = applySettings(RAW, d);
    d.instructions.rules = [];
    const second = applySettings(first, d);
    expect(ConfigSchema.parse(parse(second)).instructions.rules).toEqual([]);
  });

  it("rejects a document the config schema would reject", () => {
    const d = doc();
    // biome-ignore lint/suspicious/noExplicitAny: deliberately invalid
    (d.triage.archive as any) = ["reply"];
    expect(() => applySettings(RAW, d)).toThrow();
  });

  it("SettingsSchema gives friendly early rejection too", () => {
    expect(
      SettingsSchema.safeParse({
        ...doc(),
        llm: { provider: "grok", model: "" },
      }).success,
    ).toBe(false);
  });
});
