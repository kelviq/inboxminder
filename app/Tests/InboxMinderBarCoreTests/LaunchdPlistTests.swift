import XCTest

@testable import InboxMinderBarCore

final class LaunchdPlistTests: XCTestCase {
    // Mirrors renderPlist in src/agent/launchd.ts.
    private let plistXML = """
        <?xml version="1.0" encoding="UTF-8"?>
        <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
        <plist version="1.0">
        <dict>
          <key>Label</key>
          <string>com.inboxminder.agent</string>
          <key>ProgramArguments</key>
          <array>
            <string>/usr/local/bin/node</string>
            <string>/Users/x/inboxminder/dist/cli.js</string>
            <string>watch</string>
          </array>
          <key>RunAtLoad</key>
          <true/>
        </dict>
        </plist>
        """

    func testParsesNodeAndCliPaths() throws {
        let loc = try XCTUnwrap(
            CLILocation.parse(plistData: Data(plistXML.utf8)))
        XCTAssertEqual(loc.nodePath, "/usr/local/bin/node")
        XCTAssertEqual(loc.cliPath, "/Users/x/inboxminder/dist/cli.js")
    }

    func testGarbageAndShapelessPlistsReturnNil() {
        XCTAssertNil(CLILocation.parse(plistData: Data("nope".utf8)))
        // Valid plist, wrong shape (no ProgramArguments).
        let empty = """
            <?xml version="1.0" encoding="UTF-8"?>
            <plist version="1.0"><dict><key>Label</key><string>x</string></dict></plist>
            """
        XCTAssertNil(CLILocation.parse(plistData: Data(empty.utf8)))
        // ProgramArguments too short to name node + cli.
        let short = """
            <?xml version="1.0" encoding="UTF-8"?>
            <plist version="1.0"><dict><key>ProgramArguments</key><array><string>/bin/x</string></array></dict></plist>
            """
        XCTAssertNil(CLILocation.parse(plistData: Data(short.utf8)))
    }
}

final class PathsTests: XCTestCase {
    func testDataDirHonorsEnvOverrideLikeTheCli() {
        let home = URL(fileURLWithPath: "/Users/demo")
        let overridden = InboxMinderPaths(
            environment: [
                "INBOXMINDER_DATA_DIR": "/tmp/fixture",
                "INBOXMINDER_CONFIG_DIR": "/tmp/fixture-cfg",
            ], home: home)
        XCTAssertEqual(overridden.dataDir.path, "/tmp/fixture")
        XCTAssertEqual(overridden.statusFile.path, "/tmp/fixture/status.json")
        XCTAssertEqual(
            overridden.configToml.path, "/tmp/fixture-cfg/config.toml")
        let normal = InboxMinderPaths(environment: [:], home: home)
        XCTAssertEqual(normal.dataDir.path, "/Users/demo/.inboxminder")
        XCTAssertEqual(
            normal.watchLog.path, "/Users/demo/.inboxminder/logs/watch.log")
        XCTAssertEqual(
            normal.configToml.path, "/Users/demo/.config/inboxminder/config.toml")
        XCTAssertEqual(
            normal.launchAgentPlist.path,
            "/Users/demo/Library/LaunchAgents/com.inboxminder.agent.plist")
    }
}
