import Foundation

/// The app's ONLY write path: spawn the user's own inboxminder CLI. Argument
/// arrays only — never a shell string. Two modes: fire-and-forget for the
/// popover's actions and a captured run for onboarding (plan
/// 028), where stdin carries the payload — secrets travel there and never
/// via argv (argv is world-readable in `ps`).
public enum CLIRunner {
    /// Popover actions (pause/resume/auth/reinstall): results surface via
    /// the store's next status.json refresh, not parsed output.
    /// `environment` extends (never replaces) the app's own env — how a
    /// profile is selected (INBOXMINDER_PROFILE; env, not argv, matching the
    /// launchd plist).
    public static func run(
        _ cli: CLILocation, _ args: [String],
        environment: [String: String] = [:]
    ) {
        runDetached(
            CLIInvoker.from(location: cli), args, environment: environment)
    }

    public static func runDetached(
        _ invoker: CLIInvoker, _ args: [String],
        environment: [String: String] = [:]
    ) {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: invoker.executable)
        process.arguments = invoker.baseArgs + args
        if !environment.isEmpty {
            process.environment = ProcessInfo.processInfo.environment
                .merging(environment) { _, new in new }
        }
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice
        try? process.run()
    }

    public struct CaptureResult: Equatable {
        public let exitCode: Int32
        public let output: String
    }

    /// Synchronous captured run — callers hop off the main thread
    /// themselves. stdout+stderr are merged (onboarding shows the CLI's
    /// own narration verbatim); `onLine` streams lines as they arrive.
    /// The invocation's stdin is written fully, then closed, before
    /// waiting — payloads are small (a key, an answers JSON), far below
    /// pipe-buffer size, so this cannot deadlock.
    @discardableResult
    public static func runCapture(
        _ invoker: CLIInvoker,
        _ invocation: SetupInvocation,
        extraEnvironment: [String: String] = [:],
        onLine: ((String) -> Void)? = nil
    ) -> CaptureResult {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: invoker.executable)
        process.arguments = invoker.baseArgs + invocation.args
        if !extraEnvironment.isEmpty {
            process.environment = ProcessInfo.processInfo.environment
                .merging(extraEnvironment) { _, new in new }
        }

        let out = Pipe()
        process.standardOutput = out
        process.standardError = out

        let stdinPipe = Pipe()
        process.standardInput = stdinPipe

        var buffer = Data()
        let lock = NSLock()
        out.fileHandleForReading.readabilityHandler = { handle in
            let data = handle.availableData
            guard !data.isEmpty else { return }
            lock.lock()
            buffer.append(data)
            lock.unlock()
            if let onLine {
                for line in String(decoding: data, as: UTF8.self)
                    .split(separator: "\n")
                {
                    onLine(String(line))
                }
            }
        }

        do {
            try process.run()
        } catch {
            out.fileHandleForReading.readabilityHandler = nil
            return CaptureResult(
                exitCode: -1, output: "failed to launch: \(invoker.executable)")
        }

        if let stdin = invocation.stdin {
            stdinPipe.fileHandleForWriting.write(Data(stdin.utf8))
        }
        stdinPipe.fileHandleForWriting.closeFile()

        process.waitUntilExit()
        // Drain anything the handler hasn't seen yet, then detach it.
        let rest = out.fileHandleForReading.readDataToEndOfFile()
        out.fileHandleForReading.readabilityHandler = nil
        lock.lock()
        buffer.append(rest)
        let output = String(decoding: buffer, as: UTF8.self)
        lock.unlock()
        return CaptureResult(
            exitCode: process.terminationStatus, output: output)
    }
}
