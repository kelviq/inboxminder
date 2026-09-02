import XCTest

@testable import InboxMinderBarCore

/// Fixture walkthrough: the REAL runner against a stub CLI
/// that records argv + stdin, proving the exact command sequence and that
/// secrets travel only over stdin into the capture — never argv, never any
/// other file in the sandbox.
final class CLIRunnerTests: XCTestCase {
    private var sandbox: URL!

    override func setUpWithError() throws {
        sandbox = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("inboxminder-clirunner-\(UUID().uuidString)")
        try FileManager.default.createDirectory(
            at: sandbox, withIntermediateDirectories: true)
    }

    override func tearDownWithError() throws {
        try FileManager.default.removeItem(at: sandbox)
    }

    private func writeStubCLI() throws -> CLIInvoker {
        // Records each call as "ARGS <argv>" + "IN <stdin>" into CAP.
        let script = """
            #!/bin/sh
            echo "ARGS $@" >> "$CAP"
            echo "IN $(cat)" >> "$CAP"
            echo "stub-ok $1"
            """
        let path = sandbox.appendingPathComponent("stub-cli.sh")
        try script.write(to: path, atomically: true, encoding: .utf8)
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o755], ofItemAtPath: path.path)
        return CLIInvoker(executable: path.path)
    }

    func testStdinRoundTripThroughRealPipes() {
        let result = CLIRunner.runCapture(
            CLIInvoker(executable: "/bin/cat"),
            SetupInvocation(args: [], stdin: "sekrit-value\n", stdinIsSecret: true))
        XCTAssertEqual(result.exitCode, 0)
        XCTAssertEqual(result.output, "sekrit-value\n")
    }

    func testNonzeroExitAndLaunchFailureAreReported() {
        let fail = CLIRunner.runCapture(
            CLIInvoker(executable: "/usr/bin/false"),
            SetupInvocation(args: [], stdin: nil, stdinIsSecret: false))
        XCTAssertEqual(fail.exitCode, 1)

        let missing = CLIRunner.runCapture(
            CLIInvoker(executable: sandbox.appendingPathComponent("nope").path),
            SetupInvocation(args: [], stdin: nil, stdinIsSecret: false))
        XCTAssertEqual(missing.exitCode, -1)
    }

    func testSettingsSequenceAgainstStubCLI() throws {
        let stub = try writeStubCLI()
        let cap = sandbox.appendingPathComponent("capture.log").path
        let env = ["CAP": cap]
        let secret = "sk-ant-SUPERSECRET"

        let doc = SettingsDoc(
            llm: .init(provider: "anthropic", model: "claude-sonnet-5"),
            email: .init(
                pollIntervalSec: 45, notifications: true, skipSenders: []),
            triage: .init(enabled: true, archive: [], coldOutreachHint: ""),
            labels: .init(enabled: true, pending: "P", resolved: "R"),
            instructions: .init(rules: []))
        var lines: [String] = []
        for invocation in [
            SetupInvocation(
                args: ["set-key", "anthropic", "--stdin"], stdin: secret,
                stdinIsSecret: true),
            SettingsPlanner.getSettings(),
            SettingsPlanner.setSettings(doc),
        ] {
            let r = CLIRunner.runCapture(
                stub, invocation, extraEnvironment: env,
                onLine: { lines.append($0) })
            XCTAssertEqual(r.exitCode, 0)
        }

        let captured = try String(contentsOfFile: cap, encoding: .utf8)
        // "IN " lines carry a trailing space for empty stdin: `echo "IN
        // $(cat)"` — built by concatenation so no editor strips it.
        let expected =
            "ARGS set-key anthropic --stdin\n"
            + "IN \(secret)\n"
            + "ARGS config get-settings\n"
            + "IN \n"
            + "ARGS config set-settings --stdin\n"
            + "IN \(doc.jsonString())\n"
        XCTAssertEqual(captured, expected)
        // Streaming saw the stub's own stdout.
        XCTAssertTrue(lines.contains("stub-ok set-key"))

        // The secret exists in the sandbox ONLY inside the stub's capture
        // file — no other file, and never in any argv (argv is recorded in
        // the capture and shows only flag names).
        let files = try FileManager.default.contentsOfDirectory(
            at: sandbox, includingPropertiesForKeys: nil)
        for file in files where file.lastPathComponent != "capture.log" {
            let content = (try? String(contentsOf: file, encoding: .utf8)) ?? ""
            XCTAssertFalse(
                content.contains(secret), "secret leaked into \(file.path)")
        }
        for argsLine in captured.split(separator: "\n")
        where argsLine.hasPrefix("ARGS") {
            XCTAssertFalse(argsLine.contains(secret), "secret in argv")
        }
    }

    /// Profile selection travels as INBOXMINDER_PROFILE in the
    /// spawned env (never argv) — present for a named profile, absent for
    /// the default.
    func testDetachedSpawnCarriesProfileEnv() throws {
        let cap = sandbox.appendingPathComponent("env.log")
        let script = """
            #!/bin/sh
            echo "PROFILE=${INBOXMINDER_PROFILE-unset} ARGS=$@" >> "\(cap.path)"
            """
        let path = sandbox.appendingPathComponent("env-stub.sh")
        try script.write(to: path, atomically: true, encoding: .utf8)
        try FileManager.default.setAttributes(
            [.posixPermissions: 0o755], ofItemAtPath: path.path)
        let stub = CLIInvoker(executable: path.path)

        CLIRunner.runDetached(
            stub, ["agent", "pause"],
            environment: ["INBOXMINDER_PROFILE": "acme"])
        waitForLine(in: cap, count: 1)
        CLIRunner.runDetached(stub, ["agent", "pause"])
        waitForLine(in: cap, count: 2)

        let captured = try String(contentsOf: cap, encoding: .utf8)
        XCTAssertEqual(
            captured,
            "PROFILE=acme ARGS=agent pause\n"
                + "PROFILE=unset ARGS=agent pause\n")
    }

    /// Detached runs are fire-and-forget — poll until the stub has written.
    private func waitForLine(in file: URL, count: Int) {
        for _ in 0..<200 {
            let lines = (try? String(contentsOf: file, encoding: .utf8))?
                .split(separator: "\n").count ?? 0
            if lines >= count { return }
            usleep(10_000)
        }
        XCTFail("stub never wrote line \(count) to \(file.path)")
    }
}
