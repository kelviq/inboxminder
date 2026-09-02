import Combine
import InboxMinderBarCore
import Foundation

/// State machine for one profile's Preferences window. Loads via
/// `config get-settings`, saves via `set-settings --stdin`, offers an
/// agent restart afterwards (settings bind at daemon startup). The app
/// writes no config and reads no Keychain (house rules).
final class PreferencesStore: ObservableObject {
    enum Phase: Equatable {
        case loading
        case editing
        case saving
        /// Saved — offer restart (apply now) or close (apply on next restart).
        case saved
        case failed(String)
    }

    let paths: InboxMinderPaths
    @Published private(set) var phase: Phase = .loading
    @Published private(set) var busy = false
    @Published var errorText: String?

    /// The whole form binds into this document directly.
    @Published var doc = SettingsDoc(
        llm: .init(provider: "anthropic", model: "claude-sonnet-5"),
        email: .init(
            pollIntervalSec: 45, notifications: true, updateCheck: true,
            skipSenders: ["mailer-daemon"]),
        triage: .init(
            enabled: true, archive: [], coldOutreachHint: "",
            labels: .init(
                newsletter: "InboxMinder/Newsletter",
                notification: "InboxMinder/Notification",
                marketing: "InboxMinder/Marketing",
                coldOutreach: "InboxMinder/Cold Outreach",
                fyi: "InboxMinder/FYI",
                important: "InboxMinder/Important")),
        labels: .init(
            enabled: true, pending: "InboxMinder/Pending",
            resolved: "InboxMinder/Resolved"),
        instructions: .init(rules: []))
    @Published var skipSendersText = ""

    private var invoker: CLIInvoker?

    init(profile: String?) {
        paths = InboxMinderPaths(profile: profile)
        // CLI location: this profile's plist, else the default profile's
        // (the CLI binary is machine-wide).
        for plist in [paths.launchAgentPlist, InboxMinderPaths().launchAgentPlist] {
            if let data = try? Data(contentsOf: plist),
                let loc = CLILocation.parse(plistData: data)
            {
                invoker = .from(location: loc)
                break
            }
        }
        load()
    }

    func load() {
        guard let invoker else {
            phase = .failed(
                "No inboxminder agent installed yet — finish setup first.")
            return
        }
        phase = .loading
        run(invoker, SettingsPlanner.getSettings()) { result in
            guard result.exitCode == 0,
                let doc = SettingsDoc.decode(Data(result.output.utf8))
            else {
                self.phase = .failed(result.output)
                return
            }
            self.doc = doc
            self.skipSendersText = doc.email.skipSenders.joined(separator: ", ")
            self.phase = .editing
        }
    }

    func archiveBinding(_ category: String) -> Bool {
        doc.triage.archive.contains(category)
    }

    func setArchive(_ category: String, _ on: Bool) {
        if on {
            if !doc.triage.archive.contains(category) {
                doc.triage.archive.append(category)
            }
        } else {
            doc.triage.archive.removeAll { $0 == category }
        }
    }

    func addRule() {
        doc.instructions.rules.append(.init(match: "", note: ""))
    }

    func removeRule(id: UUID) {
        doc.instructions.rules.removeAll { $0.id == id }
    }

    func save() {
        guard let invoker else { return }
        doc.email.skipSenders = skipSendersText
            .split(whereSeparator: { $0 == "," || $0.isNewline })
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
        // Half-filled rule rows are dropped, not rejected — an empty row is
        // "never mind", and the CLI would refuse empty match/note anyway.
        doc.instructions.rules.removeAll {
            $0.match.trimmingCharacters(in: .whitespaces).isEmpty
                || $0.note.trimmingCharacters(in: .whitespaces).isEmpty
        }
        phase = .saving
        run(invoker, SettingsPlanner.setSettings(doc)) { result in
            if result.exitCode == 0 {
                self.phase = .saved
            } else {
                self.phase = .editing
                self.errorText = result.output
            }
        }
    }

    /// Apply now: restart this profile's agent (the same spawn the
    /// popover's reinstall performs).
    func restartAgent() {
        guard let invoker else { return }
        CLIRunner.runDetached(
            invoker, SettingsPlanner.restartArgs,
            environment: paths.cliEnvironment)
    }

    private func run(
        _ invoker: CLIInvoker, _ invocation: SetupInvocation,
        completion: @escaping (CLIRunner.CaptureResult) -> Void
    ) {
        busy = true
        errorText = nil
        let environment = paths.cliEnvironment
        DispatchQueue.global().async {
            let result = CLIRunner.runCapture(
                invoker, invocation, extraEnvironment: environment)
            DispatchQueue.main.async {
                self.busy = false
                completion(result)
            }
        }
    }
}
