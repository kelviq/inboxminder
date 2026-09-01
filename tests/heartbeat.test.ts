import { describe, expect, it } from "vitest";
import { formatAge, heartbeatStatus } from "../src/agent/launchd.js";

describe("formatAge", () => {
  it("formats sub-minute ages as seconds", () => {
    expect(formatAge(32_000)).toBe("32s");
  });

  it("formats sub-hour ages as minutes", () => {
    expect(formatAge(5 * 60_000)).toBe("5m");
  });

  it("formats long ages as hours", () => {
    expect(formatAge(35 * 3_600_000)).toBe("35h");
  });
});

describe("heartbeatStatus", () => {
  const pollIntervalSec = 45;

  it("reports missing when no heartbeat has ever been recorded (fresh install)", () => {
    expect(heartbeatStatus(Date.now(), null, pollIntervalSec)).toEqual({
      state: "missing",
      ageMs: null,
      ageDisplay: null,
    });
  });

  it("reports ok for a recent tick", () => {
    const now = 1_000_000;
    const result = heartbeatStatus(now, now - 32_000, pollIntervalSec);
    expect(result.state).toBe("ok");
    expect(result.ageDisplay).toBe("32s");
  });

  it("stays ok exactly at the 5x-poll-interval boundary", () => {
    const now = 1_000_000;
    const result = heartbeatStatus(
      now,
      now - 5 * pollIntervalSec * 1000,
      pollIntervalSec,
    );
    expect(result.state).toBe("ok");
  });

  it("goes stale just past the 5x-poll-interval boundary", () => {
    const now = 1_000_000;
    const result = heartbeatStatus(
      now,
      now - (5 * pollIntervalSec * 1000 + 1),
      pollIntervalSec,
    );
    expect(result.state).toBe("stale");
  });

  it("reports stale for a day-long stall (the Aug 10 incident shape)", () => {
    const now = Date.now();
    const result = heartbeatStatus(now, now - 35 * 3_600_000, pollIntervalSec);
    expect(result.state).toBe("stale");
    expect(result.ageDisplay).toBe("35h");
  });
});
