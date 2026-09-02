import XCTest

@testable import InboxMinderBarCore

final class DaemonStateTests: XCTestCase {
    private let now = Date(timeIntervalSince1970: 1_000_000)

    private func status(
        v: Int = 1, pid: Int = 42, tickAgeMs: Double = 10_000,
        staleAfterMs: Double = 225_000, paused: Bool = false,
        reauthNeeded: Bool = false
    ) -> StatusFile {
        StatusFile(
            v: v, pid: pid,
            tickAt: now.timeIntervalSince1970 * 1000 - tickAgeMs,
            staleAfterMs: staleAfterMs, paused: paused,
            reauthNeeded: reauthNeeded, selfEmail: "me@example.com",
            activity: [])
    }

    private func derive(
        configExists: Bool = true, plistExists: Bool = true,
        status: StatusFile?, pidAlive: Bool = true
    ) -> Derived {
        DaemonStateDeriver.derive(
            configExists: configExists, plistExists: plistExists,
            status: status, pidAlive: { _ in pidAlive }, now: now)
    }

    func testNoConfigWinsOverEverything() {
        let d = derive(configExists: false, plistExists: true, status: status())
        XCTAssertEqual(d.run, .setupNeededNoConfig)
        XCTAssertNil(d.status)
    }

    func testConfigButNoPlistMeansRunUp() {
        let d = derive(plistExists: false, status: status())
        XCTAssertEqual(d.run, .setupNeededNoAgent)
    }

    func testAbsentStatusFileMeansNotReporting() {
        XCTAssertEqual(derive(status: nil).run, .notReporting)
    }

    func testUnknownVersionMeansNotReporting() {
        XCTAssertEqual(derive(status: status(v: 2)).run, .notReporting)
    }

    func testDeadPidMeansNotRunning() {
        let d = derive(status: status(reauthNeeded: true), pidAlive: false)
        XCTAssertEqual(d.run, .notRunning)
        // reauth still surfaces — the flag is orthogonal to run state.
        XCTAssertTrue(d.reauthNeeded)
    }

    func testStaleTickMeansStalled() {
        let d = derive(status: status(tickAgeMs: 300_000))
        guard case .stalled(let age) = d.run else {
            return XCTFail("expected stalled, got \(d.run)")
        }
        XCTAssertEqual(age, 300_000)
    }

    func testStalledBeatsPaused() {
        // The heartbeat keeps ticking while paused; a stale paused daemon is
        // a frozen daemon (mirrors the CLI's precedence comment).
        let d = derive(status: status(tickAgeMs: 300_000, paused: true))
        guard case .stalled = d.run else {
            return XCTFail("expected stalled, got \(d.run)")
        }
    }

    func testPaused() {
        XCTAssertEqual(derive(status: status(paused: true)).run, .paused)
    }

    func testHealthyOkWithAge() {
        let d = derive(status: status(tickAgeMs: 32_000))
        guard case .ok(let age) = d.run else {
            return XCTFail("expected ok, got \(d.run)")
        }
        XCTAssertEqual(age, 32_000)
        XCTAssertFalse(d.reauthNeeded)
        XCTAssertNotNil(d.status)
    }

    func testReauthOrthogonalToOkAndPaused() {
        XCTAssertTrue(derive(status: status(reauthNeeded: true)).reauthNeeded)
        XCTAssertTrue(
            derive(status: status(paused: true, reauthNeeded: true))
                .reauthNeeded)
    }

    func testFutureTickClampsToZeroAge() {
        // Clock skew: tickAt slightly in the future must read as age 0, not
        // negative (and certainly not stalled).
        let d = derive(status: status(tickAgeMs: -5_000))
        XCTAssertEqual(d.run, .ok(ageMs: 0))
    }
}

final class AgeFormatTests: XCTestCase {
    func testMirrorsCliFormatAge() {
        // Same cases the TS side renders: "32s", "5m", "35h".
        XCTAssertEqual(AgeFormat.short(ms: 0), "0s")
        XCTAssertEqual(AgeFormat.short(ms: 32_000), "32s")
        XCTAssertEqual(AgeFormat.short(ms: 59_400), "59s")
        XCTAssertEqual(AgeFormat.short(ms: 5 * 60_000), "5m")
        XCTAssertEqual(AgeFormat.short(ms: 35 * 3_600_000), "35h")
        XCTAssertEqual(AgeFormat.short(ms: -500), "0s")
    }
}
