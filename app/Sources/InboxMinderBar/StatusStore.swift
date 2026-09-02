import Combine
import Darwin
import InboxMinderBarCore
import Foundation

/// The UI's single source of state: reads the daemon's surfaces (status.json,
/// launchd plist, config presence), derives the display state via Core, and
/// refreshes on directory-watch events + a 30s timer + popover opens.
/// Read-only by construction — the only writes this app ever performs are
/// CLI spawns in CLIRunner. Everything runs on the main queue.
final class StatusStore: ObservableObject {
    @Published private(set) var derived = Derived(
        run: .notReporting, reauthNeeded: false, status: nil)
    /// Optimistic UI after a pause/resume click, until status.json confirms
    /// (the daemon notices the flag within one poll interval).
    @Published private(set) var pendingPause: Bool?

    let paths: InboxMinderPaths
    private(set) var cli: CLILocation?

    private var dirSource: DispatchSourceFileSystemObject?
    private var dirFD: CInt = -1
    private var timer: Timer?

    /// One store per profile; the no-arg default is the default
    /// profile — exactly the pre-030 single-store behavior.
    init(paths: InboxMinderPaths = InboxMinderPaths()) {
        self.paths = paths
        refresh()
        startTimer()
    }

    deinit { stopWatching() }

    func refresh() {
        let fm = FileManager.default
        let status = (try? Data(contentsOf: paths.statusFile))
            .flatMap(StatusFile.decode)
        cli = (try? Data(contentsOf: paths.launchAgentPlist))
            .flatMap(CLILocation.parse)
        let d = DaemonStateDeriver.derive(
            configExists: fm.fileExists(atPath: paths.configToml.path),
            plistExists: fm.fileExists(atPath: paths.launchAgentPlist.path),
            status: status,
            pidAlive: { pid in
                // EPERM = alive but not ours — still alive.
                Darwin.kill(pid_t(pid), 0) == 0 || errno == EPERM
            },
            now: Date())
        if let pending = pendingPause {
            let isPaused = d.run == .paused
            if isPaused == pending { pendingPause = nil }
        }
        derived = d
        // The data dir can appear after launch (fresh setups) — keep trying
        // to arm the watch until it sticks; the timer covers the meantime.
        if dirSource == nil { startWatching() }
    }

    // MARK: actions (all delegate to the CLI — the single source of truth)

    func setPaused(_ paused: Bool) {
        guard let cli else { return }
        pendingPause = paused
        CLIRunner.run(
            cli, ["agent", paused ? "pause" : "resume"],
            environment: paths.cliEnvironment)
        scheduleFollowupRefresh()
    }

    func reauthorize() {
        guard let cli else { return }
        CLIRunner.run(cli, ["auth"], environment: paths.cliEnvironment)
    }

    func reinstallAgent() {
        guard let cli else { return }
        CLIRunner.run(
            cli, ["agent", "install"], environment: paths.cliEnvironment)
        scheduleFollowupRefresh()
    }

    // MARK: refresh plumbing

    private func scheduleFollowupRefresh() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in
            self?.refresh()
        }
    }

    private func startTimer() {
        timer = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) {
            [weak self] _ in
            DispatchQueue.main.async { self?.refresh() }
        }
    }

    private func startWatching() {
        // Watch the DIRECTORY: status.json is atomically rename-replaced
        // each tick, so a file-fd watch would go stale after one write.
        let fd = open(paths.dataDir.path, O_EVTONLY)
        guard fd >= 0 else { return }
        dirFD = fd
        let source = DispatchSource.makeFileSystemObjectSource(
            fileDescriptor: fd, eventMask: .write, queue: .main)
        source.setEventHandler { [weak self] in self?.refresh() }
        source.setCancelHandler { close(fd) }
        source.resume()
        dirSource = source
    }

    private func stopWatching() {
        dirSource?.cancel()
        dirSource = nil
    }
}
