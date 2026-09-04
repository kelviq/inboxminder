import Foundation

/// `inboxminder setup-status` output — the CLI's yes/no ledger of which
/// setup pieces exist (existence only; values never cross this boundary,
/// preserving the app's no-Keychain rule).
public struct SetupStatusDoc: Codable, Equatable {
    public let config: Bool
    public let llmKey: Bool
    public let gmailClient: Bool
    public let gmailTokens: Bool
    public let agent: Bool

    public init(
        config: Bool, llmKey: Bool, gmailClient: Bool, gmailTokens: Bool,
        agent: Bool
    ) {
        self.config = config
        self.llmKey = llmKey
        self.gmailClient = gmailClient
        self.gmailTokens = gmailTokens
        self.agent = agent
    }

    public static func decode(_ raw: String) -> SetupStatusDoc? {
        // The CLI may narrate warnings before the JSON line; take the
        // last line that parses.
        for line in raw.split(separator: "\n").reversed() {
            if let doc = try? JSONDecoder().decode(
                SetupStatusDoc.self, from: Data(line.utf8))
            {
                return doc
            }
        }
        return nil
    }
}

/// Wizard steps in order. Re-entrancy is DERIVED, never stored: quit at
/// any point, relaunch, and the first unmet condition is where you
/// resume (plan 053).
public enum OnboardingStep: Equatable, CaseIterable {
    case welcome, llm, gmail, authorize, goLive, done
}

public enum OnboardingProgress {
    /// The first thing the wizard still needs. Config-without-key and
    /// key-without-config both land on .llm — that step rewrites both
    /// sides atomically, so a half-state heals instead of wedging.
    public static func firstUnmet(_ s: SetupStatusDoc) -> OnboardingStep {
        if !s.config || !s.llmKey { return .llm }
        if !s.gmailClient { return .gmail }
        if !s.gmailTokens { return .authorize }
        if !s.agent { return .goLive }
        return .done
    }

    /// Should the wizard open on launch? Only on a genuinely fresh
    /// default profile: any existing config or agent means someone set
    /// this machine up already (npm, another session) and auto-opening
    /// a setup window at them would be wrong.
    public static func isNeeded(
        configExists: Bool, agentPlistExists: Bool
    ) -> Bool {
        !configExists && !agentPlistExists
    }
}
