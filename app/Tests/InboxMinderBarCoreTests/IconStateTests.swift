import XCTest

@testable import InboxMinderBarCore

final class IconStateTests: XCTestCase {
    private func derived(
        _ run: Derived.RunState, reauth: Bool = false
    ) -> Derived {
        Derived(run: run, reauthNeeded: reauth, status: nil)
    }

    func testSingleProfileMatchesThePre030Mapping() {
        XCTAssertEqual(
            IconState.symbol(for: [derived(.ok(ageMs: 1))]), "envelope")
        XCTAssertEqual(
            IconState.symbol(for: [derived(.paused)]), "pause.circle")
        XCTAssertEqual(
            IconState.symbol(for: [derived(.setupNeededNoConfig)]), "gearshape")
        XCTAssertEqual(
            IconState.symbol(for: [derived(.setupNeededNoAgent)]), "gearshape")
        for bad: Derived.RunState in [
            .stalled(ageMs: 999_999), .notRunning, .notReporting,
        ] {
            XCTAssertEqual(
                IconState.symbol(for: [derived(bad)]),
                "exclamationmark.triangle")
        }
        XCTAssertEqual(
            IconState.symbol(for: [derived(.ok(ageMs: 1), reauth: true)]),
            "exclamationmark.triangle")
    }

    func testWorstStateWinsAcrossProfiles() {
        XCTAssertEqual(
            IconState.symbol(for: [
                derived(.ok(ageMs: 1)), derived(.stalled(ageMs: 1_000_000)),
            ]),
            "exclamationmark.triangle")
        XCTAssertEqual(
            IconState.symbol(for: [
                derived(.ok(ageMs: 1)), derived(.paused, reauth: true),
            ]),
            "exclamationmark.triangle")
        XCTAssertEqual(
            IconState.symbol(for: [
                derived(.ok(ageMs: 1)), derived(.setupNeededNoAgent),
            ]),
            "gearshape")
    }

    func testMixedOkAndPausedStillWatches() {
        XCTAssertEqual(
            IconState.symbol(for: [derived(.ok(ageMs: 1)), derived(.paused)]),
            "envelope")
        XCTAssertEqual(
            IconState.symbol(for: [derived(.paused), derived(.paused)]),
            "pause.circle")
    }
}
