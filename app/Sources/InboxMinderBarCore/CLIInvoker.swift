import Foundation

/// How to execute the inboxminder CLI: a resolved executable plus fixed base
/// args. Two shapes exist: `node dist/cli.js …` (plist or manual locate)
/// and a global `inboxminder` bin (`command -v` hit).
/// One planned CLI run: argv plus optional stdin (secrets travel ONLY via
/// stdin, never argv — the house rule).
public struct SetupInvocation: Equatable {
    public let args: [String]
    public let stdin: String?
    public let stdinIsSecret: Bool

    public init(args: [String], stdin: String?, stdinIsSecret: Bool) {
        self.args = args
        self.stdin = stdin
        self.stdinIsSecret = stdinIsSecret
    }
}

public struct CLIInvoker: Equatable {
    public let executable: String
    public let baseArgs: [String]

    public init(executable: String, baseArgs: [String] = []) {
        self.executable = executable
        self.baseArgs = baseArgs
    }

    /// The launchd plist stays the source of truth whenever it exists
    ///; onboarding falls back to probe/picker only
    /// before the first `agent install`.
    public static func from(location: CLILocation) -> CLIInvoker {
        CLIInvoker(
            executable: location.nodePath, baseArgs: [location.cliPath])
    }

    public static func globalBin(_ path: String) -> CLIInvoker {
        CLIInvoker(executable: path)
    }
}

/// Pre-plist CLI discovery. The login-shell probe is a FIXED
/// string — user input is never interpolated into any shell command; when
/// the probe fails, the UI falls back to a file picker, never to
/// heuristics.
public enum CLIDiscovery {
    /// Run as: /bin/zsh -l -c <probeScript> — the login shell inherits the
    /// user's PATH (nvm, homebrew) that GUI apps don't see.
    public static let probeShell = "/bin/zsh"
    public static let probeScript =
        "echo D:$(command -v inboxminder); echo N:$(command -v node)"

    public static func parse(
        probeOutput: String
    ) -> (inboxminderBin: String?, nodeBin: String?) {
        var inboxminder: String?
        var node: String?
        for rawLine in probeOutput.split(separator: "\n") {
            let line = rawLine.trimmingCharacters(in: .whitespaces)
            if line.hasPrefix("D:") {
                let v = String(line.dropFirst(2))
                if v.hasPrefix("/") { inboxminder = v }
            } else if line.hasPrefix("N:") {
                let v = String(line.dropFirst(2))
                if v.hasPrefix("/") { node = v }
            }
        }
        return (inboxminder, node)
    }
}
