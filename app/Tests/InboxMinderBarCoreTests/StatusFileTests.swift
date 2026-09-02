import XCTest

@testable import InboxMinderBarCore

final class StatusFileTests: XCTestCase {
    // Mirrors the live v1 shape written by src/agent/status-file.ts, plus an
    // unknown field to prove additive daemon changes can't break the reader.
    private let v1JSON = """
        {
          "v": 1,
          "pid": 7956,
          "tickAt": 1787815672336,
          "staleAfterMs": 225000,
          "paused": false,
          "reauthNeeded": true,
          "selfEmail": "founder@example.com",
          "futureField": "ignored",
          "activity": [
            {
              "kind": "draft",
              "subject": "Re: invoice question",
              "threadId": "18c2fe61b3a9d701",
              "messageId": "<CAF+invoice@mail.gmail.com>",
              "detail": null,
              "at": 1787815451246,
              "futureRowField": 42
            }
          ]
        }
        """

    func testDecodesV1ContractIgnoringUnknownFields() throws {
        let status = try XCTUnwrap(StatusFile.decode(Data(v1JSON.utf8)))
        XCTAssertEqual(status.v, 1)
        XCTAssertEqual(status.pid, 7956)
        XCTAssertEqual(status.tickAt, 1_787_815_672_336)
        XCTAssertEqual(status.staleAfterMs, 225_000)
        XCTAssertFalse(status.paused)
        XCTAssertTrue(status.reauthNeeded)
        XCTAssertEqual(status.selfEmail, "founder@example.com")
        XCTAssertEqual(status.activity.count, 1)
        let row = status.activity[0]
        XCTAssertEqual(row.kind, "draft")
        XCTAssertEqual(row.subject, "Re: invoice question")
        XCTAssertEqual(row.threadId, "18c2fe61b3a9d701")
        XCTAssertEqual(row.messageId, "<CAF+invoice@mail.gmail.com>")
        XCTAssertNil(row.detail)
        // Pre-026 file: no `path` key — must decode to nil, never fail.
        XCTAssertNil(row.path)
        XCTAssertEqual(row.at, 1_787_815_451_246)
        // Pre-029 file: no `profile` key — must decode to nil (default).
        XCTAssertNil(status.profile)
    }

    func testDecodesProfileWhenPresent() throws {
        // Post-029 daemon: status.json names the profile that wrote it.
        let json = """
            {
              "v": 1, "pid": 1, "tickAt": 0, "staleAfterMs": 225000,
              "paused": false, "reauthNeeded": false, "selfEmail": "x@y",
              "profile": "acme", "activity": []
            }
            """
        let status = try XCTUnwrap(StatusFile.decode(Data(json.utf8)))
        XCTAssertEqual(status.profile, "acme")
    }

    func testDecodesPathWhenPresent() throws {
        // Post-026 daemon: docs rows carry the artifact's absolute path.
        let json = """
            {
              "v": 1, "pid": 1, "tickAt": 0, "staleAfterMs": 225000,
              "paused": false, "reauthNeeded": false, "selfEmail": "x@y",
              "activity": [
                { "kind": "docs_draft", "subject": "Refund policy",
                  "threadId": null, "messageId": null,
                  "detail": "refunds/policy.mdx",
                  "path": "/Users/x/docs-repo/refunds/policy.mdx",
                  "at": 5 }
              ]
            }
            """
        let status = try XCTUnwrap(StatusFile.decode(Data(json.utf8)))
        XCTAssertEqual(
            status.activity[0].path, "/Users/x/docs-repo/refunds/policy.mdx")
    }

    func testMalformedInputDecodesToNilNeverThrows() {
        XCTAssertNil(StatusFile.decode(Data("not json".utf8)))
        XCTAssertNil(StatusFile.decode(Data("{}".utf8)))
        XCTAssertNil(StatusFile.decode(Data()))
        // Truncated mid-file, as a torn non-atomic write would look.
        XCTAssertNil(StatusFile.decode(Data(v1JSON.prefix(80).utf8)))
    }
}
