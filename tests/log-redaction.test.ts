import pino from "pino";
import { describe, expect, it } from "vitest";
import { safeError } from "../src/log.js";

describe("safeError", () => {
  it("drops request/response body fields from APICallError-like errors", () => {
    const err = Object.assign(new Error("boom"), {
      requestBodyValues: { prompt: "SECRET_EMAIL_BODY" },
      responseBody: "SECRET_RESPONSE",
      responseHeaders: { authorization: "Bearer SECRET_TOKEN" },
      data: { foo: "SECRET_DATA" },
      config: { url: "https://example.com" },
      cause: new Error("SECRET_CAUSE"),
    });

    const safe = safeError(err);

    expect(safe).toEqual({
      type: "Error",
      message: "boom",
      stack: err.stack,
      statusCode: undefined,
      status: undefined,
    });
    expect(Object.keys(safe).sort()).toEqual(
      ["message", "stack", "status", "statusCode", "type"].sort(),
    );
  });

  it("preserves statusCode/status when present", () => {
    const err = Object.assign(new Error("rate limited"), {
      statusCode: 429,
      status: 429,
      requestBodyValues: { prompt: "SECRET" },
    });

    const safe = safeError(err);

    expect(safe.statusCode).toBe(429);
    expect(safe.status).toBe(429);
  });

  it("stringifies non-Error values without leaking structure", () => {
    expect(safeError("plain string")).toEqual({ message: "plain string" });
  });
});

describe("log serializer wiring", () => {
  it("never writes secret request/response content to the log stream", () => {
    const chunks: string[] = [];
    const stream = {
      write(chunk: string) {
        chunks.push(chunk);
      },
    };

    const testLog = pino(
      { serializers: { err: safeError, error: safeError } },
      stream,
    );

    const err = Object.assign(new Error("boom"), {
      requestBodyValues: { prompt: "SECRET_EMAIL_BODY" },
      responseBody: "SECRET_RESPONSE",
    });

    testLog.warn({ err }, "request failed");

    const output = chunks.join("");
    expect(output).toContain("boom");
    expect(output).not.toContain("SECRET_EMAIL_BODY");
    expect(output).not.toContain("SECRET_RESPONSE");
  });
});
