import XCTest

@testable import InboxMinderBarCore

final class BundledRuntimeTests: XCTestCase {
    let root = URL(fileURLWithPath: "/Applications/InboxMinder.app")

    func plist(node: String, cli: String) -> Data {
        let xml = """
            <?xml version="1.0" encoding="UTF-8"?>
            <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
            <plist version="1.0"><dict>
            <key>ProgramArguments</key>
            <array><string>\(node)</string><string>\(cli)</string><string>watch</string></array>
            </dict></plist>
            """
        return Data(xml.utf8)
    }

    // MARK: locate

    func testLocateNeedsBothFiles() {
        let node = root.appendingPathComponent(BundledRuntime.nodeRelPath).path
        let cli = root.appendingPathComponent(BundledRuntime.cliRelPath).path

        XCTAssertNil(
            BundledRuntime.locate(bundleRoot: root) { $0 == node },
            "cli.js missing → runtime treated as absent")
        XCTAssertNil(
            BundledRuntime.locate(bundleRoot: root) { $0 == cli },
            "node missing → runtime treated as absent")

        let found = BundledRuntime.locate(bundleRoot: root) { _ in true }
        XCTAssertEqual(found?.executable, node)
        XCTAssertEqual(found?.baseArgs, [cli])
    }

    func testManagesMatchesOnlyOwnRuntime() {
        let bundled = BundledRuntime.locate(bundleRoot: root) { _ in true }!
        XCTAssertTrue(BundledRuntime.manages(invoker: bundled, bundleRoot: root))
        let npm = CLIInvoker(
            executable: "/opt/homebrew/bin/node",
            baseArgs: ["/opt/homebrew/lib/node_modules/inboxminder/dist/cli.js"])
        XCTAssertFalse(BundledRuntime.manages(invoker: npm, bundleRoot: root))
    }

    // MARK: resolver order (plan 053 D3 — never hijack an existing install)

    func testPlistWinsOverBundled() {
        let bundled = BundledRuntime.locate(bundleRoot: root) { _ in true }
        let r = SetupCLIResolver.resolve(
            plistData: plist(
                node: "/opt/homebrew/bin/node",
                cli: "/opt/homebrew/lib/node_modules/inboxminder/dist/cli.js"),
            bundled: bundled)
        guard case .agentPlist(let invoker) = r else {
            return XCTFail("expected agentPlist, got \(r)")
        }
        XCTAssertEqual(invoker.executable, "/opt/homebrew/bin/node")
    }

    func testBundledWhenNoAgent() {
        let bundled = BundledRuntime.locate(bundleRoot: root) { _ in true }
        let r = SetupCLIResolver.resolve(plistData: nil, bundled: bundled)
        guard case .bundled(let invoker) = r else {
            return XCTFail("expected bundled, got \(r)")
        }
        XCTAssertTrue(invoker.executable.hasSuffix("runtime/bin/node"))
    }

    func testUnparsablePlistFallsThroughToBundled() {
        let bundled = BundledRuntime.locate(bundleRoot: root) { _ in true }
        let r = SetupCLIResolver.resolve(
            plistData: Data("garbage".utf8), bundled: bundled)
        guard case .bundled = r else {
            return XCTFail("expected bundled fallback, got \(r)")
        }
    }

    func testNoneWhenDevBuildWithoutRuntimeOrAgent() {
        let r = SetupCLIResolver.resolve(plistData: nil, bundled: nil)
        XCTAssertEqual(r, SetupCLIResolver.Resolution.none)
        XCTAssertNil(SetupCLIResolver.invoker(r))
    }
}
