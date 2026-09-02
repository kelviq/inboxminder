import Foundation

/// Decoded `~/.inboxminder/status.json` — the daemon's versioned read surface
///. Codable ignores unknown JSON keys,
/// so additive daemon-side fields never break this reader; a `v` bump is
/// handled in `DaemonStateDeriver` (unknown version → `.notReporting`).
public struct StatusFile: Codable, Equatable {
    public let v: Int
    public let pid: Int
    /// Epoch milliseconds of the last watcher tick (heartbeat).
    public let tickAt: Double
    /// Staleness threshold, computed daemon-side (5 × poll interval) so the
    /// rule has exactly one home — never re-derive it here.
    public let staleAfterMs: Double
    public let paused: Bool
    public let reauthNeeded: Bool
    public let selfEmail: String
    /// Which profile wrote this file. Additive — absent in
    /// older status files, which must (and do) decode to nil (default).
    public let profile: String?
    /// Newer released CLI version, or nil. Additive — absent decodes nil.
    public let updateAvailable: String?
    public let activity: [ActivityItem]

    public struct ActivityItem: Codable, Equatable {
        public let kind: String
        public let subject: String?
        public let threadId: String?
        public let messageId: String?
        public let detail: String?
        /// Absolute path of the on-disk artifact this row points to (docs
        /// rows). Additive — absent in older status files,
        /// which must (and do) decode to nil.
        public let path: String?
        /// Epoch milliseconds.
        public let at: Double

        public init(
            kind: String, subject: String?, threadId: String?,
            messageId: String?, detail: String?, path: String? = nil,
            at: Double
        ) {
            self.kind = kind
            self.subject = subject
            self.threadId = threadId
            self.messageId = messageId
            self.detail = detail
            self.path = path
            self.at = at
        }
    }

    public init(
        v: Int, pid: Int, tickAt: Double, staleAfterMs: Double, paused: Bool,
        reauthNeeded: Bool, selfEmail: String, profile: String? = nil,
        updateAvailable: String? = nil, activity: [ActivityItem]
    ) {
        self.v = v
        self.pid = pid
        self.tickAt = tickAt
        self.staleAfterMs = staleAfterMs
        self.paused = paused
        self.reauthNeeded = reauthNeeded
        self.selfEmail = selfEmail
        self.profile = profile
        self.updateAvailable = updateAvailable
        self.activity = activity
    }

    public static func decode(_ data: Data) -> StatusFile? {
        try? JSONDecoder().decode(StatusFile.self, from: data)
    }
}
