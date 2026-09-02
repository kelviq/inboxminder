import Foundation

/// Where the daemon's exact node + CLI live — parsed from the launchd plist
/// the CLI itself wrote (`renderPlist` in src/agent/launchd.ts writes
/// ProgramArguments = [nodePath, cliPath, "watch"]), so the app always
/// drives the same install the daemon runs. Deliberately no fallback
/// search paths: if this can't be parsed, actions are disabled and the UI
/// says why.
public struct CLILocation: Equatable {
    public let nodePath: String
    public let cliPath: String

    public init(nodePath: String, cliPath: String) {
        self.nodePath = nodePath
        self.cliPath = cliPath
    }

    public static func parse(plistData: Data) -> CLILocation? {
        guard
            let obj = try? PropertyListSerialization.propertyList(
                from: plistData, format: nil),
            let dict = obj as? [String: Any],
            let args = dict["ProgramArguments"] as? [String],
            args.count >= 2
        else { return nil }
        return CLILocation(nodePath: args[0], cliPath: args[1])
    }
}
