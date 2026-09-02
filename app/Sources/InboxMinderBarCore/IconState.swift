import Foundation

/// Menu-bar glyph selection. With one profile this reduces
/// exactly to the pre-030 mapping; with several it answers "is anything
/// wrong?" — the worst state across profiles wins. Pure so tests cover
/// every combination.
public enum IconState {
    /// Severity order: attention (reauth / stalled / not running / not
    /// reporting) > setup needed > paused > watching.
    public static func symbol(for states: [Derived]) -> String {
        guard !states.isEmpty else { return "exclamationmark.triangle" }
        var anySetup = false
        var anyOk = false
        for d in states {
            if d.reauthNeeded { return "exclamationmark.triangle" }
            switch d.run {
            case .stalled, .notRunning, .notReporting:
                return "exclamationmark.triangle"
            case .setupNeededNoConfig, .setupNeededNoAgent:
                anySetup = true
            case .ok:
                anyOk = true
            case .paused:
                break
            }
        }
        if anySetup { return "gearshape" }
        // All remaining are ok/paused: anything actively watching shows the
        // envelope; pause.circle only when EVERYTHING is paused.
        return anyOk ? "envelope" : "pause.circle"
    }
}
