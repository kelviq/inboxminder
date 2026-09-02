import XCTest

@testable import InboxMinderBarCore

final class LinksTests: XCTestCase {
    func testThreadURLUsesAccountChooserWithEncodedContinue() {
        // AccountChooser is the only form that survived the live smoke —
        // see the GmailLinks doc comment for the forms that failed.
        let url = GmailLinks.thread(
            threadId: "1a03b459e3cec9d4", selfEmail: "founder@example.com")
        XCTAssertEqual(
            url?.absoluteString,
            "https://accounts.google.com/AccountChooser?Email=founder%40example.com"
                + "&continue=https%3A%2F%2Fmail.google.com%2Fmail%2F%23all%2F1a03b459e3cec9d4"
        )
    }

    func testEmptySelfEmailFallsBackToBareMailURL() {
        let url = GmailLinks.thread(threadId: "abc", selfEmail: "")
        XCTAssertEqual(
            url?.absoluteString, "https://mail.google.com/mail/#all/abc")
    }

    func testInboxGoesThroughAccountChooserToo() {
        let url = GmailLinks.inbox(selfEmail: "founder@example.com")
        XCTAssertEqual(
            url?.absoluteString,
            "https://accounts.google.com/AccountChooser?Email=founder%40example.com"
                + "&continue=https%3A%2F%2Fmail.google.com%2Fmail%2F"
        )
    }

    func testSearchURLStripsBracketsAndEncodesPlusStrictly() {
        // "+" must become %2B inside continue — query parsers read a raw
        // "+" as a space, which would corrupt the Message-ID.
        let url = GmailLinks.search(
            messageId: "<CAF+x@mail.gmail.com>", selfEmail: "founder@example.com")
        let s = url?.absoluteString ?? ""
        XCTAssertTrue(s.hasPrefix(
            "https://accounts.google.com/AccountChooser?Email=founder%40example.com"))
        XCTAssertTrue(s.contains("rfc822msgid%3ACAF%2Bx%40mail.gmail.com"))
        XCTAssertFalse(s.contains("<"))
        XCTAssertFalse(s.contains(">"))
        XCTAssertFalse(s.contains("+"))
    }

    private func item(
        threadId: String?, messageId: String?
    ) -> StatusFile.ActivityItem {
        StatusFile.ActivityItem(
            kind: "draft", subject: "s", threadId: threadId,
            messageId: messageId, detail: nil, at: 0)
    }

    func testBestPrefersThreadOverMessageId() {
        let url = GmailLinks.best(
            item: item(threadId: "t1", messageId: "<m1>"), selfEmail: "")
        XCTAssertTrue(url?.absoluteString.contains("#all/t1") ?? false)
    }

    func testBestFallsBackToMessageIdSearch() {
        let url = GmailLinks.best(
            item: item(threadId: nil, messageId: "<m1@x>"), selfEmail: "")
        XCTAssertTrue(
            url?.absoluteString.contains("#search/rfc822msgid:m1@x") ?? false)
        // Empty-string ids count as absent too.
        let url2 = GmailLinks.best(
            item: item(threadId: "", messageId: "<m1@x>"), selfEmail: "")
        XCTAssertTrue(url2?.absoluteString.contains("rfc822msgid") ?? false)
    }

    func testBestIsNilForRowsWithoutIds() {
        XCTAssertNil(
            GmailLinks.best(
                item: item(threadId: nil, messageId: nil), selfEmail: "x@y"))
    }
}
