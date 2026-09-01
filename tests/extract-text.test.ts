import type { gmail_v1 } from "googleapis";
import { describe, expect, it } from "vitest";
import { extractText } from "../src/email/gmail.js";

const b64 = (s: string | Buffer) => Buffer.from(s).toString("base64url");

const part = (
  mimeType: string,
  body: string | Buffer,
  headers: Record<string, string> = {},
): gmail_v1.Schema$MessagePart => ({
  mimeType,
  body: { data: b64(body) },
  headers: Object.entries(headers).map(([name, value]) => ({ name, value })),
});

describe("extractText", () => {
  it("prefers text/plain even when html comes FIRST in the part tree", () => {
    const payload: gmail_v1.Schema$MessagePart = {
      mimeType: "multipart/alternative",
      parts: [
        part("text/html", "<p>rich version</p>"),
        part("text/plain", "plain version"),
      ],
    };
    expect(extractText(payload)).toBe("plain version");
  });

  it("finds a nested text/plain over a shallower text/html", () => {
    const payload: gmail_v1.Schema$MessagePart = {
      mimeType: "multipart/mixed",
      parts: [
        part("text/html", "<p>html</p>"),
        {
          mimeType: "multipart/alternative",
          parts: [part("text/plain", "deep plain")],
        },
      ],
    };
    expect(extractText(payload)).toBe("deep plain");
  });

  it("html-only: strips script/style/head, decodes entities, no tags survive", () => {
    const html = `<head><title>t</title><style>p{color:red}</style></head>
      <body><script>var x = "evil&amp;";</script>
      <p>Tom &amp; Jerry&#39;s&nbsp;&quot;deal&quot; &lt;secret&gt;</p></body>`;
    const out = extractText(part("text/html", html));
    // No tag remnants — but decoded &lt;/&gt; legitimately yield literal
    // angle brackets AFTER stripping (entities are decoded last so they
    // can never be re-interpreted as tags).
    for (const remnant of ["<p>", "</p>", "<body", "<head", "<script"]) {
      expect(out).not.toContain(remnant);
    }
    expect(out).not.toContain("&amp;");
    expect(out).not.toContain("color:red");
    expect(out).not.toContain("evil"); // script contents gone entirely
    expect(out).toContain(`Tom & Jerry's "deal" <secret>`);
  });

  it("decodes double-escaped entities exactly once (no iterative decode)", () => {
    expect(extractText(part("text/html", "a &amp;lt; b"))).toBe("a &lt; b");
  });

  it("honors a declared ISO-8859-1 charset instead of assuming utf8", () => {
    const latin1Cafe = Buffer.from([0x63, 0x61, 0x66, 0xe9]); // "café"
    const out = extractText(
      part("text/plain", latin1Cafe, {
        "Content-Type": 'text/plain; charset="ISO-8859-1"',
      }),
    );
    expect(out).toBe("café");
    // The same bytes read as utf8 would have produced a replacement char.
    expect(latin1Cafe.toString("utf8")).toContain("�");
  });

  it("honors charset on html parts too", () => {
    const latin1Html = Buffer.from([
      ...Buffer.from("<p>caf"),
      0xe9,
      ...Buffer.from("</p>"),
    ]);
    const out = extractText(
      part("text/html", latin1Html, {
        "Content-Type": "text/html; charset=iso-8859-1",
      }),
    );
    expect(out.trim()).toBe("café");
  });

  it("falls back to utf8 on an unknown charset label instead of throwing", () => {
    const out = extractText(
      part("text/plain", "still fine", {
        "Content-Type": 'text/plain; charset="x-banana"',
      }),
    );
    expect(out).toBe("still fine");
  });

  it("returns empty for bodyless payloads", () => {
    expect(extractText({ mimeType: "multipart/alternative", parts: [] })).toBe(
      "",
    );
  });
});
