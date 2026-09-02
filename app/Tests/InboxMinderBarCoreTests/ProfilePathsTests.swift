import XCTest

@testable import InboxMinderBarCore

final class ProfilePathsTests: XCTestCase {
    private var sandbox: URL!
    private var home: URL!
    private var env: [String: String]!

    override func setUpWithError() throws {
        sandbox = URL(fileURLWithPath: NSTemporaryDirectory())
            .appendingPathComponent("inboxminder-profiles-\(UUID().uuidString)")
        home = sandbox.appendingPathComponent("home")
        try FileManager.default.createDirectory(
            at: home, withIntermediateDirectories: true)
        env = [
            "INBOXMINDER_DATA_DIR": sandbox.appendingPathComponent("data").path,
            "INBOXMINDER_CONFIG_DIR": sandbox.appendingPathComponent("cfg").path,
        ]
    }

    override func tearDownWithError() throws {
        try FileManager.default.removeItem(at: sandbox)
    }

    private func mkdir(_ url: URL) throws {
        try FileManager.default.createDirectory(
            at: url, withIntermediateDirectories: true)
    }

    private func touch(_ url: URL, _ contents: String = "") throws {
        try mkdir(url.deletingLastPathComponent())
        try contents.data(using: .utf8)!.write(to: url)
    }

    func testDefaultProfileDerivesExactlyLikePre030() {
        let paths = InboxMinderPaths(environment: env, home: home)
        XCTAssertNil(paths.profile)
        XCTAssertEqual(paths.dataDir, paths.baseDataDir)
        XCTAssertEqual(paths.configDir, paths.baseConfigDir)
        XCTAssertEqual(paths.launchdLabel, "com.inboxminder.agent")
        XCTAssertEqual(
            paths.launchAgentPlist,
            home.appendingPathComponent(
                "Library/LaunchAgents/com.inboxminder.agent.plist"))
        XCTAssertTrue(paths.cliEnvironment.isEmpty)
    }

    func testNamedProfileNestsUnderBaseAndOwnsLabel() {
        let paths = InboxMinderPaths(profile: "acme", environment: env, home: home)
        XCTAssertEqual(
            paths.dataDir,
            paths.baseDataDir.appendingPathComponent("profiles/acme"))
        XCTAssertEqual(
            paths.configToml,
            paths.baseConfigDir.appendingPathComponent(
                "profiles/acme/config.toml"))
        XCTAssertEqual(paths.launchdLabel, "com.inboxminder.agent.acme")
        XCTAssertEqual(
            paths.launchAgentPlist.lastPathComponent,
            "com.inboxminder.agent.acme.plist")
        XCTAssertEqual(
            paths.cliEnvironment, ["INBOXMINDER_PROFILE": "acme"])
    }

    func testDiscoveryListsDefaultPlusRealProfiles() throws {
        let base = InboxMinderPaths(environment: env, home: home)
        // acme: has a status.json → shown. beta: plist only → shown
        // (installed but not yet ticking). ghost: empty dir → hidden.
        // config-only: init ran but no agent yet → shown.
        try touch(
            base.baseDataDir.appendingPathComponent(
                "profiles/acme/status.json"), "{}")
        try mkdir(base.baseDataDir.appendingPathComponent("profiles/beta"))
        try touch(
            home.appendingPathComponent(
                "Library/LaunchAgents/com.inboxminder.agent.beta.plist"))
        try mkdir(base.baseDataDir.appendingPathComponent("profiles/ghost"))
        try touch(
            base.baseConfigDir.appendingPathComponent(
                "profiles/configonly/config.toml"))
        try mkdir(
            base.baseDataDir.appendingPathComponent("profiles/configonly"))

        let discovered = InboxMinderPaths.discoverProfiles(
            environment: env, home: home)
        XCTAssertEqual(
            discovered.map(\.profile), [nil, "acme", "beta", "configonly"])
    }

    func testDiscoveryWithNoProfilesDirIsJustDefault() {
        let discovered = InboxMinderPaths.discoverProfiles(
            environment: env, home: home)
        XCTAssertEqual(discovered.map(\.profile), [nil])
    }
}

final class ProfileNameTests: XCTestCase {
    func testValidNamesMirrorTheCLIRule() {
        XCTAssertTrue(ProfileName.isValid("acme"))
        XCTAssertTrue(ProfileName.isValid("acme-support"))
        XCTAssertTrue(ProfileName.isValid("p2"))
        XCTAssertTrue(ProfileName.isValid(String(repeating: "x", count: 32)))
    }

    func testInvalidNamesRejected() {
        for bad in [
            "Acme", "a.b", "a b", "-lead", "", "default",
            String(repeating: "x", count: 33), "../escape", "a/b",
        ] {
            XCTAssertFalse(ProfileName.isValid(bad), bad)
        }
    }

    func testNormalizeMapsDefaultAndEmptyToNil() {
        XCTAssertEqual(ProfileName.normalize("acme").profile, "acme")
        XCTAssertTrue(ProfileName.normalize("acme").valid)
        XCTAssertNil(ProfileName.normalize("default").profile)
        XCTAssertTrue(ProfileName.normalize("default").valid)
        XCTAssertNil(ProfileName.normalize("  ").profile)
        XCTAssertTrue(ProfileName.normalize("  ").valid)
        XCTAssertFalse(ProfileName.normalize("Bad Name").valid)
    }
}
