import Foundation

/// Filesystem layout, honoring INBOXMINDER_DATA_DIR exactly like the CLI does —
/// that override is the fixture-driven dev/test path (the app's
/// live-machine rule: development never points at the real ~/.inboxminder).
/// Profiles: a named profile nests both dirs under the
/// BASE dir's `profiles/<name>/` and owns a per-profile launchd label —
/// all derivations mirror the CLI (src/config/load.ts, labelFor in
/// src/agent/launchd.ts). `profile == nil` is the default profile and
/// derives byte-identically to the pre-profile layout.
public struct InboxMinderPaths {
    /// nil = the default profile.
    public let profile: String?
    public let baseDataDir: URL
    public let baseConfigDir: URL
    public let dataDir: URL
    public let configDir: URL
    public let launchAgentPlist: URL

    public init(
        profile: String? = nil,
        environment: [String: String] = ProcessInfo.processInfo.environment,
        home: URL = FileManager.default.homeDirectoryForCurrentUser
    ) {
        self.profile = profile
        if let override = environment["INBOXMINDER_DATA_DIR"], !override.isEmpty {
            baseDataDir = URL(fileURLWithPath: override)
        } else {
            baseDataDir = home.appendingPathComponent(".inboxminder")
        }
        // Mirrors the CLI's INBOXMINDER_CONFIG_DIR — and since child
        // processes inherit the environment, a fixture-launched app spawns a
        // fixture-sandboxed CLI automatically.
        if let override = environment["INBOXMINDER_CONFIG_DIR"], !override.isEmpty {
            baseConfigDir = URL(fileURLWithPath: override)
        } else {
            baseConfigDir = home.appendingPathComponent(".config/inboxminder")
        }
        if let profile {
            dataDir = baseDataDir
                .appendingPathComponent("profiles")
                .appendingPathComponent(profile)
            configDir = baseConfigDir
                .appendingPathComponent("profiles")
                .appendingPathComponent(profile)
        } else {
            dataDir = baseDataDir
            configDir = baseConfigDir
        }
        launchAgentPlist = home.appendingPathComponent(
            "Library/LaunchAgents/\(Self.launchdLabel(profile: profile)).plist")
    }

    /// Mirrors `labelFor` in src/agent/launchd.ts — prefix-stable so named
    /// profiles are globbable next to the default.
    public static func launchdLabel(profile: String?) -> String {
        profile.map { "com.inboxminder.agent.\($0)" } ?? "com.inboxminder.agent"
    }

    public var launchdLabel: String { Self.launchdLabel(profile: profile) }

    public var statusFile: URL { dataDir.appendingPathComponent("status.json") }
    public var watchLog: URL {
        dataDir.appendingPathComponent("logs/watch.log")
    }
    public var configToml: URL { configDir.appendingPathComponent("config.toml") }
    public var instructionsMd: URL {
        configDir.appendingPathComponent("instructions.md")
    }

    /// The env the CLI must be spawned with to act on THIS profile —
    /// env, not argv, matching how the launchd plist selects one.
    public var cliEnvironment: [String: String] {
        profile.map { ["INBOXMINDER_PROFILE": $0] } ?? [:]
    }

    /// Default profile + every directory under `<base>/profiles/`. A named
    /// profile is listed when its dir holds a status.json OR its plist
    /// exists — a just-installed-but-not-yet-ticked profile still renders
    /// as "starting" instead of vanishing. Filesystem-only, read-only.
    public static func discoverProfiles(
        environment: [String: String] = ProcessInfo.processInfo.environment,
        home: URL = FileManager.default.homeDirectoryForCurrentUser
    ) -> [InboxMinderPaths] {
        let base = InboxMinderPaths(
            profile: nil, environment: environment, home: home)
        var result = [base]
        let fm = FileManager.default
        let profilesDir = base.baseDataDir.appendingPathComponent("profiles")
        let names =
            (try? fm.contentsOfDirectory(
                at: profilesDir, includingPropertiesForKeys: [.isDirectoryKey],
                options: .skipsHiddenFiles))?
            .filter { (try? $0.resourceValues(forKeys: [.isDirectoryKey]))?.isDirectory == true }
            .map(\.lastPathComponent)
            .sorted() ?? []
        for name in names {
            let candidate = InboxMinderPaths(
                profile: name, environment: environment, home: home)
            if fm.fileExists(atPath: candidate.statusFile.path)
                || fm.fileExists(atPath: candidate.launchAgentPlist.path)
                || fm.fileExists(atPath: candidate.configToml.path)
            {
                result.append(candidate)
            }
        }
        return result
    }
}

/// Mirrors the CLI's profile-name rule (src/config/profile.ts): 1-32 chars
/// of lowercase letters, digits, and hyphens, starting with a letter or
/// digit; "default" is reserved (it means the ABSENCE of a name).
public enum ProfileName {
    public static func isValid(_ name: String) -> Bool {
        guard name != "default" else { return false }
        return name.range(
            of: "^[a-z0-9][a-z0-9-]{0,31}$", options: .regularExpression
        ) != nil
    }

    /// User input → profile value: trims, maps "default"/"" to nil (the
    /// default profile), rejects anything else invalid with nil + false.
    public static func normalize(_ input: String) -> (
        profile: String?, valid: Bool
    ) {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty || trimmed == "default" { return (nil, true) }
        return isValid(trimmed) ? (trimmed, true) : (nil, false)
    }
}

/// Mirrors `formatAge` in src/agent/launchd.ts so both frontends render the
/// same "32s" / "5m" / "35h" strings.
public enum AgeFormat {
    public static func short(ms: Double) -> String {
        let sec = max(0, Int((ms / 1000).rounded()))
        if sec < 60 { return "\(sec)s" }
        let min = Int((Double(sec) / 60).rounded())
        if min < 60 { return "\(min)m" }
        let hr = Int((Double(min) / 60).rounded())
        return "\(hr)h"
    }
}
