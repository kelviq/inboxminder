import type { gmail_v1 } from "googleapis";
import { describe, expect, it } from "vitest";
import { foldHistory } from "../src/email/gmail.js";

const page = (
  history: gmail_v1.Schema$History[],
): gmail_v1.Schema$ListHistoryResponse => ({ history });

const record = (
  id: string,
  ...messageIds: string[]
): gmail_v1.Schema$History => ({
  id,
  messagesAdded: messageIds.map((m) => ({ message: { id: m } })),
});

describe("foldHistory", () => {
  it("advances the cursor to the MAX record id, not the last seen", () => {
    const { ids, cursor } = foldHistory(
      [page([record("5", "a"), record("9", "b"), record("7", "c")])],
      "3",
    );
    expect(cursor).toBe("9");
    expect(ids.sort()).toEqual(["a", "b", "c"]);
  });

  it("dedupes message ids across records and pages", () => {
    const { ids } = foldHistory(
      [
        page([record("4", "a", "b")]),
        page([record("5", "b"), record("6", "a", "c")]),
      ],
      "3",
    );
    expect(ids.sort()).toEqual(["a", "b", "c"]);
  });

  it("empty history keeps the cursor exactly where it was", () => {
    expect(foldHistory([], "42")).toEqual({ ids: [], cursor: "42" });
    expect(foldHistory([page([])], "42")).toEqual({ ids: [], cursor: "42" });
    expect(foldHistory([{}], "42")).toEqual({ ids: [], cursor: "42" });
  });

  it("a record id BELOW the cursor never moves it backwards", () => {
    const { cursor } = foldHistory([page([record("10", "x")])], "20");
    expect(cursor).toBe("20");
  });

  it("compares record ids beyond Number.MAX_SAFE_INTEGER correctly (BigInt path)", () => {
    // Naive Number() comparison would see these as equal.
    const last = "9007199254740993";
    const bigger = "9007199254740994";
    const { cursor } = foldHistory([page([record(bigger, "m")])], last);
    expect(cursor).toBe(bigger);
    // And string comparison would get THIS one wrong ("9" > "10").
    expect(foldHistory([page([record("10", "m")])], "9").cursor).toBe("10");
  });

  it("tolerates records with missing ids or messages", () => {
    const messy: gmail_v1.Schema$ListHistoryResponse = {
      history: [
        { messagesAdded: [{ message: { id: "a" } }] }, // no record id
        { id: "8", messagesAdded: [{ message: {} }, {}] }, // no message ids
        { id: "12" }, // no messagesAdded
      ],
    };
    expect(foldHistory([messy], "5")).toEqual({ ids: ["a"], cursor: "12" });
  });

  it("chained folds carry one cursor across label streams (how pollMailHistory uses it)", () => {
    const inbox = foldHistory([page([record("7", "i1")])], "3");
    const sent = foldHistory([page([record("5", "s1")])], inbox.cursor);
    expect(sent.cursor).toBe("7"); // SENT's lower record never regresses it
    expect(sent.ids).toEqual(["s1"]);
  });
});
