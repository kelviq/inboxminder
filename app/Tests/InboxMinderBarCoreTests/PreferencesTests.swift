import XCTest

@testable import InboxMinderBarCore

final class PreferencesTests: XCTestCase {
    private func sampleDoc() -> SettingsDoc {
        SettingsDoc(
            llm: .init(provider: "anthropic", model: "claude-sonnet-5"),
            email: .init(
                pollIntervalSec: 45, notifications: true,
                skipSenders: ["mailer-daemon"]),
            triage: .init(
                enabled: true, archive: ["newsletter"],
                coldOutreachHint: "friends are warm"),
            labels: .init(
                enabled: true, pending: "InboxMinder/Pending",
                resolved: "InboxMinder/Resolved"),
            instructions: .init(rules: [
                .init(match: "@vip.example", note: "Always important.")
            ]))
    }

    /// The Swift↔CLI JSON contract, pinned byte-for-byte: sorted keys,
    /// exactly the CLI SettingsSchema's key set — a drift on either side
    /// fails loudly here.
    func testJsonContractPin() {
        XCTAssertEqual(
            sampleDoc().jsonString(),
            "{\"email\":{\"notifications\":true,\"pollIntervalSec\":45,"
                + "\"skipSenders\":[\"mailer-daemon\"]},"
                + "\"instructions\":{\"rules\":[{\"match\":\"@vip.example\","
                + "\"note\":\"Always important.\"}]},"
                + "\"labels\":{\"enabled\":true,"
                + "\"pending\":\"InboxMinder/Pending\","
                + "\"resolved\":\"InboxMinder/Resolved\"},"
                + "\"llm\":{\"model\":\"claude-sonnet-5\","
                + "\"provider\":\"anthropic\"},"
                + "\"triage\":{\"archive\":[\"newsletter\"],"
                + "\"coldOutreachHint\":\"friends are warm\","
                + "\"enabled\":true}}")
    }

    func testDecodeRoundTrip() {
        let doc = sampleDoc()
        let decoded = SettingsDoc.decode(Data(doc.jsonString().utf8))
        XCTAssertEqual(decoded, doc)
    }

    /// Rule ids are UI-only identity — they must never reach the wire, and
    /// decoding must not require them.
    func testRuleIdNeverEncoded() {
        XCTAssertFalse(sampleDoc().jsonString().contains("\"id\""))
        let decoded = SettingsDoc.decode(
            Data("""
                {"llm":{"provider":"openai","model":"gpt-5"},
                 "email":{"pollIntervalSec":45,"notifications":false,"skipSenders":[]},
                 "triage":{"enabled":true,"archive":[],"coldOutreachHint":""},
                 "labels":{"enabled":true,"pending":"P","resolved":"R"},
                 "instructions":{"rules":[{"match":"a@b.c","note":"n"}]}}
                """.utf8))
        XCTAssertEqual(decoded?.instructions.rules.first?.match, "a@b.c")
    }

    func testPlannerInvocations() {
        XCTAssertEqual(
            SettingsPlanner.getSettings().args, ["config", "get-settings"])
        let set = SettingsPlanner.setSettings(sampleDoc())
        XCTAssertEqual(set.args, ["config", "set-settings", "--stdin"])
        XCTAssertEqual(set.stdin, sampleDoc().jsonString())
        XCTAssertFalse(set.stdinIsSecret)
        XCTAssertEqual(SettingsPlanner.restartArgs, ["agent", "install"])
    }

    /// Must mirror the CLI's TRIAGE_CATEGORIES (order included — the
    /// Preferences window renders in this order).
    func testTriageCategorySet() {
        XCTAssertEqual(
            TriageCategory.all,
            ["newsletter", "notification", "marketing", "cold-outreach", "fyi"]
        )
        XCTAssertEqual(
            TriageCategory.displayName("cold-outreach"), "Cold outreach")
        XCTAssertEqual(TriageCategory.displayName("fyi"), "FYI")
    }
}
