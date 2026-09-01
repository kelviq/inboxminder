import { describe, expect, it } from "vitest";
import { ConfigSchema } from "../src/config/schema.js";
import type { InboundMessage } from "../src/email/gmail.js";
import { fromAddress, skipReason, toAddresses } from "../src/email/watcher.js";

const SELF = "founder@example.com";

function msg(overrides: Partial<InboundMessage>): InboundMessage {
  return {
    id: "m1",
    threadId: "t1",
    from: "someone@example.com",
    to: SELF,
    subject: "Hello",
    messageIdHeader: "<m1@example.com>",
    references: "",
    listUnsubscribe: false,
    bodyText: "Hi, quick question about pricing.",
    ...overrides,
  };
}

const defaults = ConfigSchema.parse({});
const custom = ConfigSchema.parse({
  email: { skipSenders: ["mailer-daemon", "noreply@corp.example"] },
});

describe("skipReason", () => {
  it("passes normal external mail to the classifier", () => {
    expect(skipReason(defaults, msg({}), SELF)).toBeNull();
  });

  it("newsletters and noreply mail are NOT skipped — they get classified for a category", () => {
    expect(
      skipReason(defaults, msg({ listUnsubscribe: true }), SELF),
    ).toBeNull();
    expect(
      skipReason(defaults, msg({ from: "noreply@stripe.example" }), SELF),
    ).toBeNull();
  });

  it("skips the user's own messages", () => {
    expect(skipReason(defaults, msg({ from: `Me <${SELF}>` }), SELF)).toBe(
      "self-sender",
    );
  });

  it("skips bounces via the default skipSenders", () => {
    expect(
      skipReason(defaults, msg({ from: "mailer-daemon@googlemail.com" }), SELF),
    ).toBe("skipSenders match");
  });

  it("skips configured senders", () => {
    expect(
      skipReason(custom, msg({ from: "noreply@corp.example" }), SELF),
    ).toBe("skipSenders match");
  });

  it("skips empty bodies", () => {
    expect(skipReason(defaults, msg({ bodyText: "" }), SELF)).toBe(
      "empty body",
    );
  });

  // --- Matching runs on the ADDRESS, not the whole header ------------------

  it("does NOT skip a display name containing a skip word", () => {
    expect(
      skipReason(
        custom,
        msg({ from: "The Mailer-Daemon Band <band@x.com>" }),
        SELF,
      ),
    ).toBeNull();
  });

  it("does NOT let a display name carrying the user's own address force a skip", () => {
    expect(
      skipReason(defaults, msg({ from: `${SELF} <attacker@evil.com>` }), SELF),
    ).toBeNull();
  });
});

describe("fromAddress", () => {
  it("extracts the bracketed address, lowercased and trimmed", () => {
    expect(fromAddress("Jane Doe <Jane@Example.COM >")).toBe(
      "jane@example.com",
    );
    expect(fromAddress("bare@example.com")).toBe("bare@example.com");
    expect(fromAddress("  Spaced <a@b.c>  ")).toBe("a@b.c");
  });
});

describe("toAddresses", () => {
  it("extracts every address from a recipient list, never display names", () => {
    expect(
      toAddresses('Alice <alice@x.com>, "Doe, John" <j@x.com>, b@y.com'),
    ).toEqual(["alice@x.com", "j@x.com", "b@y.com"]);
    expect(toAddresses("")).toEqual([]);
  });
});
