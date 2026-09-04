import AppKit
import InboxMinderBarCore
import SwiftUI

/// First-run wizard (plan 053): a setup-assistant layout — brand rail on
/// the left with live step states, content on the right. Every action
/// drives the bundled CLI; closing at any point is safe, and reopening
/// resumes at the first unmet condition.
struct OnboardingView: View {
    @StateObject private var store = OnboardingStore()
    @Environment(\.dismiss) private var dismiss

    /// Brand orange (#ff4500) — matches the site and app icon.
    static let brand = Color(red: 1.0, green: 0.27, blue: 0.0)

    var body: some View {
        Group {
            if store.phase == .noCLI {
                noCLIView
            } else if store.step == .welcome {
                welcome
            } else if store.step == .done {
                doneStep
            } else {
                HStack(spacing: 0) {
                    sidebar
                    Divider()
                    VStack(spacing: 0) {
                        stepContent
                            .frame(
                                maxWidth: .infinity, maxHeight: .infinity,
                                alignment: .topLeading)
                            .padding(28)
                        if let error = store.errorText {
                            errorBox(error)
                        }
                        if store.showTerminalHatch {
                            terminalHatch
                        }
                    }
                }
            }
        }
        .frame(width: 700, height: 520)
        .onAppear {
            store.refresh(andAdvance: false)
            NSApp.activate(ignoringOtherApps: true)
        }
        .onDisappear {
            // Closed before finishing: point at where setup lives, so
            // the window never feels lost (re-entry is derived, so any
            // path back resumes at the right step).
            if store.phase == .ready, store.step != .done {
                TrayBalloon.show(
                    "Setup will wait. Click the leaf in your menu bar to continue.")
            }
        }
    }

    // MARK: sidebar

    private struct RailStep {
        let step: OnboardingStep
        let name: String
        let symbol: String
    }

    private let railSteps: [RailStep] = [
        RailStep(step: .llm, name: "Choose your AI", symbol: "cpu"),
        RailStep(step: .gmail, name: "Connect Gmail", symbol: "envelope"),
        RailStep(
            step: .authorize, name: "Authorize", symbol: "checkmark.shield"),
        RailStep(step: .goLive, name: "Go live", symbol: "play.circle"),
    ]

    private var sidebar: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 9) {
                Image(nsImage: NSApp.applicationIconImage)
                    .resizable().frame(width: 30, height: 30)
                Text("InboxMinder").font(.headline)
            }
            .padding(.bottom, 28)

            ForEach(Array(railSteps.enumerated()), id: \.element.step) {
                index, rail in
                // Completed steps are clickable: going back to change an
                // answer (a different API key, a fixed client id) re-runs
                // that step; Continue then re-derives the resume point,
                // so nothing downstream is lost. Upcoming steps stay
                // locked — no skipping ahead.
                Button {
                    if railState(rail.step) == .done, !store.busy {
                        store.step = rail.step
                    }
                } label: {
                    HStack(spacing: 10) {
                        railBadge(for: rail.step, index: index)
                        Text(rail.name)
                            .font(
                                .callout.weight(
                                    rail.step == store.step
                                        ? .semibold : .regular)
                            )
                            .foregroundColor(
                                railState(rail.step) == .upcoming
                                    ? .secondary : .primary)
                    }
                }
                .buttonStyle(.plain)
                .help(
                    railState(rail.step) == .done
                        ? "Go back to this step" : "")
                .padding(.vertical, 4)
                if index < railSteps.count - 1 {
                    Rectangle()
                        .fill(Color.secondary.opacity(0.25))
                        .frame(width: 1.5, height: 16)
                        .padding(.leading, 11)
                }
            }

            Spacer()

            if store.step != .done {
                Button(
                    store.showTerminalHatch
                        ? "Hide terminal steps" : "Prefer the terminal?"
                ) {
                    store.showTerminalHatch.toggle()
                }
                .buttonStyle(.link)
                .font(.caption)
            }
        }
        .padding(20)
        .frame(width: 190, alignment: .leading)
        .background(Color(nsColor: .windowBackgroundColor))
    }

    private enum RailState { case done, current, upcoming }

    private func railState(_ step: OnboardingStep) -> RailState {
        let order: [OnboardingStep] = [.llm, .gmail, .authorize, .goLive]
        guard
            let here = order.firstIndex(of: store.step),
            let mine = order.firstIndex(of: step)
        else { return .upcoming }
        if mine < here { return .done }
        if mine == here { return .current }
        return .upcoming
    }

    @ViewBuilder private func railBadge(
        for step: OnboardingStep, index: Int
    ) -> some View {
        switch railState(step) {
        case .done:
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 17))
                .foregroundColor(.green)
                .frame(width: 24, height: 24)
        case .current:
            ZStack {
                Circle().fill(Self.brand)
                Text("\(index + 1)")
                    .font(.caption.bold()).foregroundColor(.white)
            }
            .frame(width: 22, height: 22)
            .frame(width: 24, height: 24)
        case .upcoming:
            ZStack {
                Circle().strokeBorder(
                    Color.secondary.opacity(0.35), lineWidth: 1.5)
                Text("\(index + 1)")
                    .font(.caption).foregroundColor(.secondary)
            }
            .frame(width: 22, height: 22)
            .frame(width: 24, height: 24)
        }
    }

    // MARK: full-bleed screens

    private var welcome: some View {
        VStack(spacing: 0) {
            Spacer()
            Image(nsImage: NSApp.applicationIconImage)
                .resizable().frame(width: 84, height: 84)
                .shadow(color: .black.opacity(0.15), radius: 12, y: 4)
            Text("Welcome to InboxMinder")
                .font(.largeTitle.bold())
                .padding(.top, 18)
            Text("The gatekeeper for your inbox.")
                .font(.title3)
                .foregroundColor(.secondary)
                .padding(.top, 4)

            HStack(spacing: 14) {
                welcomeCard(
                    symbol: "lock.laptopcomputer",
                    title: "Runs on your Mac",
                    text: "Your mail is read locally, with your own AI key.")
                welcomeCard(
                    symbol: "tag",
                    title: "Sorts with labels",
                    text: "Every email judged and labeled, right in Gmail.")
                welcomeCard(
                    symbol: "hand.raised",
                    title: "Never sends",
                    text: "No sending, no deleting. Labels only.")
            }
            .padding(.top, 30)
            .padding(.horizontal, 36)

            Spacer()
            Button {
                store.begin()
            } label: {
                Text("Get Started")
                    .font(.body.weight(.semibold))
                    .frame(minWidth: 160)
            }
            .controlSize(.large)
            .buttonStyle(.borderedProminent)
            .tint(Self.brand)
            .keyboardShortcut(.defaultAction)
            Text("About five minutes. No terminal needed.")
                .font(.caption)
                .foregroundColor(.secondary)
                .padding(.top, 10)
                .padding(.bottom, 28)
        }
    }

    private func welcomeCard(
        symbol: String, title: String, text: String
    ) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            iconChip(symbol, size: 32, glyph: 15)
            Text(title).font(.callout.weight(.semibold))
            Text(text)
                .font(.caption)
                .foregroundColor(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(14)
        .frame(maxWidth: .infinity, minHeight: 118, alignment: .topLeading)
        .background(
            RoundedRectangle(cornerRadius: 10)
                .fill(Color(nsColor: .windowBackgroundColor)))
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .strokeBorder(Color.secondary.opacity(0.15)))
    }

    private var doneStep: some View {
        VStack(spacing: 0) {
            Spacer()
            ZStack {
                Circle().fill(Color.green.opacity(0.12))
                    .frame(width: 96, height: 96)
                Image(systemName: "checkmark.seal.fill")
                    .font(.system(size: 46))
                    .foregroundColor(.green)
            }
            Text("Minding your inbox")
                .font(.largeTitle.bold())
                .padding(.top, 18)
            Text(
                "Labels will appear on the next email that arrives, and the leaf in your menu bar shows the live feed."
            )
            .multilineTextAlignment(.center)
            .foregroundColor(.secondary)
            .frame(maxWidth: 400)
            .padding(.top, 6)

            HStack(spacing: 8) {
                Image(systemName: "lightbulb")
                    .foregroundColor(Self.brand)
                Text("Try it: send yourself an email and watch the label land.")
                    .font(.callout)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .background(Capsule().fill(Self.brand.opacity(0.08)))
            .padding(.top, 24)

            Spacer()
            Button {
                dismiss()
            } label: {
                Text("Done").frame(minWidth: 120)
            }
            .controlSize(.large)
            .buttonStyle(.borderedProminent)
            .tint(Self.brand)
            .keyboardShortcut(.defaultAction)
            .padding(.bottom, 32)
        }
    }

    private var noCLIView: some View {
        VStack(spacing: 12) {
            Spacer()
            iconChip("terminal", size: 44, glyph: 20)
            Text("This build has no bundled engine").font(.headline)
            Text(
                "You're running a from-source build. Install the CLI and run setup in a terminal:"
            )
            .multilineTextAlignment(.center)
            .foregroundColor(.secondary)
            copyableCommand("npm i -g inboxminder && inboxminder init")
            Spacer()
        }
        .padding(28)
    }

    // MARK: step content

    @ViewBuilder private var stepContent: some View {
        switch store.step {
        case .llm: llmStep
        case .gmail: gmailStep
        case .authorize: authorizeStep
        case .goLive: goLiveStep
        default: EmptyView()
        }
    }

    private var llmStep: some View {
        stepScaffold(
            symbol: "cpu",
            title: "Choose your AI",
            subtitle:
                "One model call scores each email. Your key goes straight into the macOS Keychain and never leaves this Mac."
        ) {
            labeledField("Provider") {
                Picker("", selection: $store.provider) {
                    Text("Anthropic").tag("anthropic")
                    Text("OpenAI").tag("openai")
                    Text("Google").tag("google")
                    Text("OpenAI-compatible (Ollama, LM Studio…)")
                        .tag("openai-compatible")
                }
                .labelsHidden()
                .onChange(of: store.provider) { _ in store.providerChanged() }
            }
            modelField
            if store.provider == "openai-compatible" {
                labeledField("Base URL") {
                    TextField(
                        "", text: $store.baseUrl,
                        prompt: Text("http://localhost:11434/v1")
                    )
                    .textFieldStyle(.roundedBorder)
                    .font(.body.monospaced())
                }
                hint("Point at Ollama or LM Studio for a fully local setup.")
            }
            labeledField("API key") {
                SecureField("", text: $store.llmKey)
                    .textFieldStyle(.roundedBorder)
            }
        } action: {
            continueButton(
                store.busy ? "Saving…" : "Continue",
                disabled: store.busy || store.model.isEmpty
                    || store.llmKey.isEmpty
            ) { store.submitLLM() }
        }
    }

    /// Hosted providers get a curated picker (nobody should have to go
    /// find a model string); "Custom" reveals free text for anything
    /// newer or unusual. openai-compatible is always free text.
    @ViewBuilder private var modelField: some View {
        if let curated = OnboardingStore.curatedModels[store.provider] {
            labeledField("Model") {
                Picker(
                    "",
                    selection: Binding(
                        get: {
                            store.modelIsCustom ? "__custom" : store.model
                        },
                        set: { value in
                            if value == "__custom" {
                                store.modelIsCustom = true
                                store.model = ""
                            } else {
                                store.modelIsCustom = false
                                store.model = value
                            }
                        })
                ) {
                    ForEach(curated, id: \.id) { option in
                        Text(
                            option.note.isEmpty
                                ? option.id
                                : "\(option.id)  ·  \(option.note)"
                        )
                        .tag(option.id)
                    }
                    Divider()
                    Text("Custom…").tag("__custom")
                }
                .labelsHidden()
            }
            if store.modelIsCustom {
                TextField(
                    "", text: $store.model,
                    prompt: Text("paste any model id")
                )
                .textFieldStyle(.roundedBorder)
                .font(.body.monospaced())
                modelHint
            }
        } else {
            labeledField("Model") {
                TextField("", text: $store.model)
                    .textFieldStyle(.roundedBorder)
                    .font(.body.monospaced())
            }
            modelHint
        }
    }

    /// Where to find valid model ids for the chosen provider — the
    /// default is fine, but the curious shouldn't have to guess.
    @ViewBuilder private var modelHint: some View {
        let docs: [String: (String, String)] = [
            "anthropic": (
                "Anthropic's model list",
                "https://docs.claude.com/en/docs/about-claude/models"
            ),
            "openai": (
                "OpenAI's model list",
                "https://platform.openai.com/docs/models"
            ),
            "google": (
                "Google's model list",
                "https://ai.google.dev/gemini-api/docs/models"
            ),
        ]
        if let (name, url) = docs[store.provider] {
            HStack(spacing: 4) {
                Text("The default works; other ids are in")
                Link(name, destination: URL(string: url)!)
            }
            .font(.caption)
            .foregroundColor(.secondary)
        } else {
            Text(
                "Any model your server exposes; with Ollama, `ollama list` shows what's installed."
            )
            .font(.caption)
            .foregroundColor(.secondary)
        }
    }

    private var gmailStep: some View {
        stepScaffold(
            symbol: "envelope",
            title: "Connect your own Gmail app",
            subtitle:
                "This is the one step Google makes everyone do: reading mail is a restricted Gmail permission, so you connect through your own private Google app rather than a shared one. About five minutes, once."
        ) {
            Link(
                destination: URL(
                    string:
                        "https://github.com/kelviq/inboxminder/blob/main/docs/gmail-setup.md"
                )!
            ) {
                HStack(spacing: 6) {
                    Image(systemName: "book")
                    Text("Open the step-by-step walkthrough")
                    Image(systemName: "arrow.up.right").font(.caption2)
                }
            }
            .font(.callout.weight(.medium))
            labeledField("Client ID") {
                SecureField("", text: $store.gmailClientId)
                    .textFieldStyle(.roundedBorder)
            }
            labeledField("Client secret") {
                SecureField("", text: $store.gmailClientSecret)
                    .textFieldStyle(.roundedBorder)
            }
            hint("Both are stored only in your macOS Keychain.")
            DisclosureGroup("Why can't InboxMinder do this for me?") {
                Text(
                    "A shared app would need Google's annual security audit, would cap how many people could connect, and its ID inside an open-source app would let abusers get it shut down for everyone. Your own app has no caps and nobody to trust. Either way, your mail only ever flows between your Mac and Google."
                )
                .font(.caption)
                .foregroundColor(.secondary)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 4)
            }
            .font(.callout)
        } action: {
            continueButton(
                store.busy ? "Saving…" : "Continue",
                disabled: store.busy || store.gmailClientId.isEmpty
                    || store.gmailClientSecret.isEmpty
            ) { store.submitGmail() }
        }
    }

    private var authorizeStep: some View {
        stepScaffold(
            symbol: "checkmark.shield",
            title: "Authorize Gmail",
            subtitle: "One browser sign-in connects your mailbox."
        ) {
            if store.gmailPrefilled {
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 8) {
                        Image(systemName: "checkmark.circle.fill")
                            .foregroundColor(.green)
                        Text("Using the Gmail app already set up on this Mac.")
                            .font(.callout)
                    }
                    Text(
                        "InboxMinder can mind more than one mailbox; every profile shares this same Google app, so you only ever create it once."
                    )
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.leading, 24)
                }
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(
                    RoundedRectangle(cornerRadius: 8)
                        .fill(Color.green.opacity(0.08)))
                .padding(.bottom, 4)
            }
            numberedRow(
                1, "Your browser opens Google's consent page for your app.")
            numberedRow(2, "Sign in with the Gmail account you want minded.")
            numberedRow(
                3,
                "Seeing \u{201C}Google hasn't verified this app\u{201D}? Click Advanced, then Go to inboxminder. That's Google talking about your own app."
            )
        } action: {
            continueButton(
                store.busy
                    ? "Waiting for the browser…" : "Authorize in Browser",
                disabled: store.busy
            ) { store.authorize() }
        }
    }

    private var goLiveStep: some View {
        stepScaffold(
            symbol: "play.circle",
            title: "Go live",
            subtitle:
                "This installs the background agent. From here on it just minds."
        ) {
            featureRow(
                "envelope.badge",
                "Every new email is read, scored, and labeled")
            featureRow("clock", "Checks your inbox every 45 seconds")
            featureRow(
                "moon.zzz",
                "Runs in the background; this app is optional company")
        } action: {
            continueButton(
                store.busy ? "Installing…" : "Start Minding My Inbox",
                disabled: store.busy
            ) { store.goLive() }
        }
    }

    // MARK: scaffolding

    private func stepScaffold<Fields: View, Action: View>(
        symbol: String, title: String, subtitle: String,
        @ViewBuilder fields: () -> Fields,
        @ViewBuilder action: () -> Action
    ) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            iconChip(symbol, size: 38, glyph: 17)
            Text(title).font(.title2.bold())
            Text(subtitle)
                .foregroundColor(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            fields()
            Spacer(minLength: 0)
            HStack {
                if store.busy { ProgressView().controlSize(.small) }
                Spacer()
                action()
            }
        }
    }

    private func iconChip(
        _ symbol: String, size: CGFloat, glyph: CGFloat
    ) -> some View {
        ZStack {
            RoundedRectangle(cornerRadius: size * 0.28)
                .fill(Self.brand.opacity(0.12))
            Image(systemName: symbol)
                .font(.system(size: glyph, weight: .medium))
                .foregroundColor(Self.brand)
        }
        .frame(width: size, height: size)
    }

    private func labeledField<Field: View>(
        _ label: String, @ViewBuilder field: () -> Field
    ) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.callout.weight(.medium))
            field()
        }
    }

    private func hint(_ text: String) -> some View {
        Text(text).font(.caption).foregroundColor(.secondary)
    }

    private func numberedRow(_ n: Int, _ text: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            ZStack {
                Circle().fill(Self.brand.opacity(0.12))
                Text("\(n)").font(.caption.bold()).foregroundColor(Self.brand)
            }
            .frame(width: 22, height: 22)
            Text(text)
                .font(.callout)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.vertical, 2)
    }

    private func featureRow(_ symbol: String, _ text: String) -> some View {
        HStack(spacing: 10) {
            Image(systemName: symbol)
                .font(.system(size: 15))
                .foregroundColor(Self.brand)
                .frame(width: 24)
            Text(text).font(.callout)
        }
        .padding(.vertical, 2)
    }

    private func continueButton(
        _ label: String, disabled: Bool, action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Text(label).font(.body.weight(.semibold)).frame(minWidth: 130)
        }
        .controlSize(.large)
        .buttonStyle(.borderedProminent)
        .tint(Self.brand)
        .keyboardShortcut(.defaultAction)
        .disabled(disabled)
    }

    private func errorBox(_ text: String) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundColor(.orange)
            Text(text)
                .font(.caption.monospaced())
                .textSelection(.enabled)
                .lineLimit(5)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(10)
        .background(
            RoundedRectangle(cornerRadius: 8)
                .fill(Color.orange.opacity(0.10)))
        .padding(.horizontal, 20)
        .padding(.bottom, 12)
    }

    private var terminalHatch: some View {
        HStack {
            copyableCommand(store.terminalEquivalent)
            Spacer()
        }
        .padding(.horizontal, 20)
        .padding(.bottom, 12)
    }

    private func copyableCommand(_ command: String) -> some View {
        HStack(spacing: 8) {
            Text(command).font(.caption.monospaced())
                .textSelection(.enabled)
            Button {
                NSPasteboard.general.clearContents()
                NSPasteboard.general.setString(command, forType: .string)
            } label: {
                Image(systemName: "doc.on.doc")
            }
            .buttonStyle(.plain)
            .help("Copy")
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 7)
        .background(
            RoundedRectangle(cornerRadius: 8)
                .fill(Color.secondary.opacity(0.10)))
    }
}
