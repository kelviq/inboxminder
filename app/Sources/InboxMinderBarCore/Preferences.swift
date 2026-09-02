import Foundation

/// The settings document for `config get-settings` / `set-settings
/// --stdin` (the CLI's SettingsSchema — key sets must match exactly; the
/// pinned JSON test fails loudly on drift). Everything the gatekeeper has
/// is editable here; only llm.baseUrl stays a config-file hand-edit.
public struct SettingsDoc: Codable, Equatable {
    public struct LLM: Codable, Equatable {
        /// "anthropic" | "openai" | "google" | "openai-compatible"
        public var provider: String
        public var model: String

        public init(provider: String, model: String) {
            self.provider = provider
            self.model = model
        }
    }

    public struct Email: Codable, Equatable {
        public var pollIntervalSec: Int
        public var notifications: Bool
        public var skipSenders: [String]

        public init(
            pollIntervalSec: Int, notifications: Bool, skipSenders: [String]
        ) {
            self.pollIntervalSec = pollIntervalSec
            self.notifications = notifications
            self.skipSenders = skipSenders
        }
    }

    public struct CategoryLabels: Codable, Equatable {
        public var newsletter: String
        public var notification: String
        public var marketing: String
        public var coldOutreach: String
        public var fyi: String
        public var important: String

        enum CodingKeys: String, CodingKey {
            case newsletter
            case notification
            case marketing
            case coldOutreach = "cold-outreach"
            case fyi
            case important
        }

        public init(
            newsletter: String, notification: String, marketing: String,
            coldOutreach: String, fyi: String, important: String
        ) {
            self.newsletter = newsletter
            self.notification = notification
            self.marketing = marketing
            self.coldOutreach = coldOutreach
            self.fyi = fyi
            self.important = important
        }
    }

    public struct Triage: Codable, Equatable {
        public var enabled: Bool
        /// Subset of `TriageCategory.all` — categories that skip the inbox.
        public var archive: [String]
        public var coldOutreachHint: String
        public var labels: CategoryLabels

        public init(
            enabled: Bool, archive: [String], coldOutreachHint: String,
            labels: CategoryLabels
        ) {
            self.enabled = enabled
            self.archive = archive
            self.coldOutreachHint = coldOutreachHint
            self.labels = labels
        }
    }

    public struct Labels: Codable, Equatable {
        public var enabled: Bool
        public var pending: String
        public var resolved: String

        public init(enabled: Bool, pending: String, resolved: String) {
            self.enabled = enabled
            self.pending = pending
            self.resolved = resolved
        }
    }

    public struct Rule: Codable, Equatable, Identifiable {
        public var match: String
        public var note: String
        /// UI identity only — never encoded (CodingKeys excludes it).
        public var id = UUID()

        enum CodingKeys: String, CodingKey {
            case match
            case note
        }

        public init(match: String, note: String) {
            self.match = match
            self.note = note
        }

        /// `id` is UI-only identity — equality is content-only, so a
        /// decode round-trip (which mints fresh ids) compares equal.
        public static func == (lhs: Rule, rhs: Rule) -> Bool {
            lhs.match == rhs.match && lhs.note == rhs.note
        }
    }

    public struct Instructions: Codable, Equatable {
        public var rules: [Rule]

        public init(rules: [Rule]) { self.rules = rules }
    }

    public var llm: LLM
    public var email: Email
    public var triage: Triage
    public var labels: Labels
    public var instructions: Instructions

    public init(
        llm: LLM, email: Email, triage: Triage, labels: Labels,
        instructions: Instructions
    ) {
        self.llm = llm
        self.email = email
        self.triage = triage
        self.labels = labels
        self.instructions = instructions
    }

    /// Deterministic (sorted-keys) JSON — the CLI contract discipline.
    public func jsonString() -> String {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
        guard let data = try? encoder.encode(self) else { return "{}" }
        return String(decoding: data, as: UTF8.self)
    }

    public static func decode(_ data: Data) -> SettingsDoc? {
        try? JSONDecoder().decode(SettingsDoc.self, from: data)
    }
}

/// The fixed category set — must mirror the CLI's TRIAGE_CATEGORIES.
public enum TriageCategory {
    public static let all = [
        "newsletter", "notification", "marketing", "cold-outreach", "fyi",
    ]

    public static func displayName(_ category: String) -> String {
        switch category {
        case "newsletter": return "Newsletters"
        case "notification": return "Notifications"
        case "marketing": return "Marketing"
        case "cold-outreach": return "Cold outreach"
        case "fyi": return "FYI"
        default: return category
        }
    }
}

/// Pure builders for everything the Preferences window runs.
public enum SettingsPlanner {
    public static func getSettings() -> SetupInvocation {
        SetupInvocation(
            args: ["config", "get-settings"], stdin: nil, stdinIsSecret: false)
    }

    public static func setSettings(_ doc: SettingsDoc) -> SetupInvocation {
        SetupInvocation(
            args: ["config", "set-settings", "--stdin"],
            stdin: doc.jsonString(), stdinIsSecret: false)
    }

    /// Settings apply to the daemon only after a restart — the window's
    /// "Apply and restart agent" button spawns exactly this.
    public static let restartArgs = ["agent", "install"]
}
