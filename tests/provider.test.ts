import { describe, expect, it } from "vitest";
import { ConfigSchema } from "../src/config/schema.js";
import { mailProvider } from "../src/email/provider.js";

describe("mailProvider factory", () => {
  it("default config resolves to a complete gmail implementation", () => {
    const provider = mailProvider(ConfigSchema.parse({}));
    for (const method of [
      "pollMailHistory",
      "getMessage",
      "setup",
      "setThreadLabels",
    ] as const) {
      expect(provider[method]).toBeTypeOf("function");
    }
  });

  it("returns the stateless module singleton for every gmail config", () => {
    const cfg = ConfigSchema.parse({});
    expect(mailProvider(cfg)).toBe(mailProvider(ConfigSchema.parse({})));
  });

  it("throws loudly on an unknown provider name (enum-widening guard)", () => {
    const cfg = ConfigSchema.parse({});
    const mangled = {
      ...cfg,
      email: { ...cfg.email, provider: "imap" as never },
    };
    expect(() => mailProvider(mangled)).toThrow(/unknown mail provider/i);
  });
});
