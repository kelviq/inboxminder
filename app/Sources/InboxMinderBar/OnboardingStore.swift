import Foundation
import InboxMinderBarCore
import SwiftUI

/// Engine behind the first-run wizard (plan 053). Every mutation is a
/// spawned CLI run: secrets go over stdin to `set-key --stdin` and are
/// dropped; the store holds them only in the transient form fields the
/// user is typing into. Resume state is derived from `setup-status`,
/// never stored.
@MainActor
final class OnboardingStore: ObservableObject {
    enum Phase: Equatable {
        /// A CLI exists to drive (bundled or an installed agent's).
        case ready
        /// Dev build without runtime and no agent: the wizard can't
        /// drive anything; show the terminal path instead.
        case noCLI
    }

    @Published var step: OnboardingStep = .welcome
    @Published var busy = false
    @Published var errorText: String?
    @Published var showTerminalHatch = false

    // Form fields (transient; never persisted by the app).
    @Published var provider = "anthropic"
    @Published var model = "claude-sonnet-5"
    @Published var baseUrl = ""
    @Published var llmKey = ""
    @Published var gmailClientId = ""
    @Published var gmailClientSecret = ""

    /// True when the Connect Gmail step was satisfied by credentials
    /// already on this Mac (a second profile, an earlier npm setup, a
    /// reinstall) rather than typed in this session — the Authorize
    /// screen says so, so the skipped step reads as intentional.
    @Published var gmailPrefilled = false
    private var submittedGmailThisSession = false

    let phase: Phase
    private let invoker: CLIInvoker?
    private let paths = InboxMinderPaths()

    /// QA hook: INBOXMINDER_ONBOARDING_STEP=<welcome|llm|gmail|authorize|
    /// golive|done> pins the wizard to one screen for visual review
    /// (re-entrancy derivation is skipped; buttons still run real CLI
    /// commands, so look, don't click). Env-only, never set in shipping
    /// flows.
    private let forcedStep: OnboardingStep?

    init() {
        let plistData = try? Data(contentsOf: paths.launchAgentPlist)
        let resolution = SetupCLIResolver.resolve(
            plistData: plistData, bundled: BundledRuntime.fromMainBundle())
        invoker = SetupCLIResolver.invoker(resolution)
        phase = invoker == nil ? .noCLI : .ready
        let names: [String: OnboardingStep] = [
            "welcome": .welcome, "llm": .llm, "gmail": .gmail,
            "authorize": .authorize, "golive": .goLive, "done": .done,
        ]
        forcedStep = ProcessInfo.processInfo
            .environment["INBOXMINDER_ONBOARDING_STEP"]
            .flatMap { names[$0.lowercased()] }
        if let forcedStep { step = forcedStep }
    }

    /// Default model per provider — a convenience, freely editable.
    static let defaultModels: [String: String] = [
        "anthropic": "claude-sonnet-5",
        "openai": "gpt-5.2",
        "google": "gemini-3-flash",
        "openai-compatible": "llama3.3",
    ]

    func providerChanged() {
        if let suggestion = Self.defaultModels[provider] { model = suggestion }
    }

    // MARK: CLI plumbing

    private func run(
        _ invocations: [SetupInvocation],
        then onSuccess: @escaping () -> Void
    ) {
        guard let invoker else { return }
        busy = true
        errorText = nil
        let env = paths.cliEnvironment
        Task.detached(priority: .userInitiated) { [weak self] in
            var failure: String?
            for invocation in invocations {
                let result = CLIRunner.runCapture(
                    invoker, invocation, extraEnvironment: env)
                if result.exitCode != 0 {
                    failure = result.output.isEmpty
                        ? "command failed (exit \(result.exitCode))"
                        : result.output
                    break
                }
            }
            let captured = failure
            await MainActor.run { [weak self] in
                guard let self else { return }
                self.busy = false
                if let captured {
                    self.errorText = String(captured.suffix(600))
                } else {
                    onSuccess()
                }
            }
        }
    }

    /// Re-derive the resume point from the CLI's setup ledger.
    func refresh(andAdvance: Bool = true) {
        guard forcedStep == nil else { return }
        guard let invoker else { return }
        let env = paths.cliEnvironment
        Task.detached(priority: .userInitiated) { [weak self] in
            let result = CLIRunner.runCapture(
                invoker,
                SetupInvocation(
                    args: ["setup-status"], stdin: nil, stdinIsSecret: false),
                extraEnvironment: env)
            let doc = SetupStatusDoc.decode(result.output)
            await MainActor.run { [weak self] in
                guard let self, let doc else { return }
                self.gmailPrefilled =
                    doc.gmailClient && !self.submittedGmailThisSession
                if andAdvance {
                    self.step = OnboardingProgress.firstUnmet(doc)
                }
            }
        }
    }

    // MARK: steps

    func begin() { refresh() }

    func submitLLM() {
        var answers: [String: String] = [
            "llmProvider": provider, "model": model,
        ]
        let trimmedBase = baseUrl.trimmingCharacters(in: .whitespaces)
        if provider == "openai-compatible", !trimmedBase.isEmpty {
            answers["baseUrl"] = trimmedBase
        }
        guard
            let answersData = try? JSONEncoder().encode(answers),
            let answersJSON = String(data: answersData, encoding: .utf8)
        else { return }
        let key = llmKey
        run([
            SetupInvocation(
                args: ["set-key", provider, "--stdin"], stdin: key,
                stdinIsSecret: true),
            SetupInvocation(
                args: ["init", "--answers-stdin", "--force"],
                stdin: answersJSON, stdinIsSecret: false),
        ]) { [weak self] in
            self?.llmKey = ""
            self?.refresh()
        }
    }

    func submitGmail() {
        run([
            SetupInvocation(
                args: ["set-key", "gmail-client-id", "--stdin"],
                stdin: gmailClientId.trimmingCharacters(in: .whitespaces),
                stdinIsSecret: true),
            SetupInvocation(
                args: ["set-key", "gmail-client-secret", "--stdin"],
                stdin: gmailClientSecret.trimmingCharacters(in: .whitespaces),
                stdinIsSecret: true),
        ]) { [weak self] in
            self?.gmailClientId = ""
            self?.gmailClientSecret = ""
            self?.submittedGmailThisSession = true
            self?.refresh()
        }
    }

    /// Runs the loopback OAuth flow; the CLI opens the browser and
    /// blocks until the callback (or failure).
    func authorize() {
        run([
            SetupInvocation(args: ["auth"], stdin: nil, stdinIsSecret: false)
        ]) { [weak self] in self?.refresh() }
    }

    func goLive() {
        run([
            SetupInvocation(
                args: ["agent", "install"], stdin: nil, stdinIsSecret: false)
        ]) { [weak self] in self?.refresh() }
    }

    // MARK: terminal escape hatch

    /// The command equivalent of the current step, for people who'd
    /// rather do this themselves. Static strings only — nothing typed
    /// into the form is ever interpolated into shell-pasteable text.
    var terminalEquivalent: String {
        switch step {
        case .welcome, .done: return "inboxminder up"
        case .llm: return "inboxminder init"
        case .gmail:
            return
                "inboxminder set-key gmail-client-id\ninboxminder set-key gmail-client-secret"
        case .authorize: return "inboxminder auth"
        case .goLive: return "inboxminder up"
        }
    }
}
