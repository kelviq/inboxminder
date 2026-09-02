import Foundation

/// Everything the UI needs, derived purely from injected facts — no file,
/// clock, or process access inside, so tests cover every state.
public struct Derived: Equatable {
    public enum RunState: Equatable {
        /// No config.toml — "run `inboxminder init`".
        case setupNeededNoConfig
        /// Config exists but no launchd plist — "run `inboxminder up`".
        case setupNeededNoAgent
        /// Plist present but status.json is absent, undecodable, or an
        /// unknown version — a pre-025 daemon build, most likely.
        case notReporting
        /// status.json present but its pid is dead.
        case notRunning
        case stalled(ageMs: Double)
        case paused
        case ok(ageMs: Double)
    }

    public let run: RunState
    /// Orthogonal to run state: the re-auth banner shows in any state that
    /// has a status file, alongside whatever the run state is.
    public let reauthNeeded: Bool
    /// The decoded file, for the activity feed + selfEmail-targeted links.
    public let status: StatusFile?

    public init(run: RunState, reauthNeeded: Bool, status: StatusFile?) {
        self.run = run
        self.reauthNeeded = reauthNeeded
        self.status = status
    }
}

public enum DaemonStateDeriver {
    /// Precedence mirrors the CLI's `agent status`: setup states first, then
    /// liveness, then staleness — and stalled beats paused, because the
    /// heartbeat keeps ticking while paused, so a stale paused daemon is a
    /// frozen daemon, not a paused one.
    public static func derive(
        configExists: Bool,
        plistExists: Bool,
        status: StatusFile?,
        pidAlive: (Int) -> Bool,
        now: Date
    ) -> Derived {
        guard configExists else {
            return Derived(run: .setupNeededNoConfig, reauthNeeded: false, status: nil)
        }
        guard plistExists else {
            return Derived(run: .setupNeededNoAgent, reauthNeeded: false, status: nil)
        }
        guard let s = status, s.v == 1 else {
            return Derived(run: .notReporting, reauthNeeded: false, status: nil)
        }
        guard pidAlive(s.pid) else {
            return Derived(run: .notRunning, reauthNeeded: s.reauthNeeded, status: s)
        }
        let ageMs = max(0, now.timeIntervalSince1970 * 1000 - s.tickAt)
        if ageMs > s.staleAfterMs {
            return Derived(run: .stalled(ageMs: ageMs), reauthNeeded: s.reauthNeeded, status: s)
        }
        if s.paused {
            return Derived(run: .paused, reauthNeeded: s.reauthNeeded, status: s)
        }
        return Derived(run: .ok(ageMs: ageMs), reauthNeeded: s.reauthNeeded, status: s)
    }
}
