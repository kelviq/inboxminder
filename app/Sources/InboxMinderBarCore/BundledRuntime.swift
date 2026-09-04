import Foundation

/// The node runtime + CLI shipped inside the app bundle (plan 053) —
/// what makes the DMG self-sufficient. Dev builds (`swift run`,
/// `make app` without BUNDLE_RUNTIME) don't carry it; everything here
/// answers nil in that case and callers fall back to plist/npm discovery
/// exactly as before.
public enum BundledRuntime {
    /// Root-relative layout written by scripts/bundle-runtime.sh.
    public static let nodeRelPath = "Contents/Resources/runtime/bin/node"
    public static let cliRelPath =
        "Contents/Resources/runtime/cli/dist/cli.js"

    /// Locate the runtime under an app-bundle root. Both files must
    /// exist — a half-present runtime is treated as absent, never
    /// invoked.
    public static func locate(
        bundleRoot: URL,
        fileExists: (String) -> Bool = {
            FileManager.default.fileExists(atPath: $0)
        }
    ) -> CLIInvoker? {
        let node = bundleRoot.appendingPathComponent(nodeRelPath).path
        let cli = bundleRoot.appendingPathComponent(cliRelPath).path
        guard fileExists(node), fileExists(cli) else { return nil }
        return CLIInvoker(executable: node, baseArgs: [cli])
    }

    /// The live app's own runtime (Bundle.main), if this build carries
    /// one.
    public static func fromMainBundle() -> CLIInvoker? {
        locate(bundleRoot: Bundle.main.bundleURL)
    }

    /// Is this invoker the bundled runtime under `bundleRoot`? Drives
    /// the "app-managed install" checks (update-restart offer, D5).
    public static func manages(
        invoker: CLIInvoker, bundleRoot: URL
    ) -> Bool {
        invoker.executable
            == bundleRoot.appendingPathComponent(nodeRelPath).path
    }
}

/// How setup (the onboarding wizard, plan 053) finds a CLI to drive.
/// Order is a product decision (plan 053 D3): an existing install is
/// NEVER hijacked — the plist wins whenever an agent exists; the bundled
/// runtime is the fresh-Mac path; nil means dev-without-runtime, where
/// the UI falls back to the login-shell probe / file picker.
public enum SetupCLIResolver {
    public enum Resolution: Equatable {
        case agentPlist(CLIInvoker)
        case bundled(CLIInvoker)
        case none
    }

    public static func resolve(
        plistData: Data?,
        bundled: CLIInvoker?
    ) -> Resolution {
        if let data = plistData,
            let location = CLILocation.parse(plistData: data)
        {
            return .agentPlist(CLIInvoker.from(location: location))
        }
        if let bundled { return .bundled(bundled) }
        return .none
    }

    public static func invoker(_ r: Resolution) -> CLIInvoker? {
        switch r {
        case .agentPlist(let i), .bundled(let i): return i
        case .none: return nil
        }
    }
}
