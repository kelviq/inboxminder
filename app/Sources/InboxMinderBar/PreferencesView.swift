import AppKit
import InboxMinderBarCore
import SwiftUI

/// Per-profile Preferences window. Renders and delegates — every write
/// goes through the CLI settings funnel; the app never edits config.toml
/// directly.
struct PreferencesView: View {
    @StateObject private var store: PreferencesStore
    @Environment(\.dismiss) private var dismiss

    init(profile: String?) {
        _store = StateObject(wrappedValue: PreferencesStore(profile: profile))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            header
            Divider()
            content
            if let error = store.errorText {
                Text(error).font(.caption).foregroundColor(.red)
                    .textSelection(.enabled).lineLimit(6)
            }
            Spacer(minLength: 0)
            Divider()
            footer
        }
        .padding(16)
        .frame(width: 560, height: 620, alignment: .top)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("Preferences — \(store.paths.profile ?? "default")")
                .font(.title2).bold()
            Text(
                "Saving edits config.toml through the CLI; the daemon applies changes after a restart."
            )
            .font(.caption).foregroundColor(.secondary)
        }
    }

    @ViewBuilder private var content: some View {
        switch store.phase {
        case .loading:
            Label("Loading current settings…", systemImage: "magnifyingglass")
                .font(.caption).foregroundColor(.secondary)
        case .failed(let message):
            Text(message).font(.callout).foregroundColor(.secondary)
                .textSelection(.enabled)
        case .saved:
            savedState
        case .editing, .saving:
            form.frame(maxHeight: .infinity)
        }
    }

    private var savedState: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(
                "Settings saved. The running agent still uses the old values until it restarts.",
                systemImage: "checkmark.seal")
            Button("Apply and restart agent") {
                store.restartAgent()
                dismiss()
            }
            .keyboardShortcut(.defaultAction)
            Button("Close — apply on next restart") { dismiss() }
                .buttonStyle(.link)
        }
    }

    /// `.formStyle(.grouped)` is load-bearing (macOS 13+): the default
    /// `.columns` style right-aligns every label into a phantom left column
    /// and clips/doesn't scroll at a fixed frame. Grouped forms left-align
    /// rows and scroll natively.
    private var form: some View {
        Form {
            Section("Gatekeeper") {
                Toggle("Triage every email", isOn: $store.doc.triage.enabled)
                VStack(alignment: .leading, spacing: 4) {
                    Text(
                        "Archive these categories (skip the inbox — the label always stays as the audit trail)"
                    )
                    .font(.caption).foregroundColor(.secondary)
                    ForEach(TriageCategory.all, id: \.self) { category in
                        Toggle(
                            TriageCategory.displayName(category),
                            isOn: Binding(
                                get: { store.archiveBinding(category) },
                                set: { store.setArchive(category, $0) }))
                    }
                }
                .disabled(!store.doc.triage.enabled)
                VStack(alignment: .leading, spacing: 4) {
                    Text("What counts as a warm intro (cold-outreach hint)")
                        .font(.caption).foregroundColor(.secondary)
                    TextField(
                        "e.g. founders asking about my product are never cold",
                        text: $store.doc.triage.coldOutreachHint
                    )
                    .textFieldStyle(.roundedBorder)
                }
                .disabled(!store.doc.triage.enabled)
            }
            Section("Reply tracking") {
                Toggle(
                    "Pending / Resolved labels on reply-worthy threads",
                    isOn: $store.doc.labels.enabled)
                if store.doc.labels.enabled {
                    TextField("Pending label", text: $store.doc.labels.pending)
                        .textFieldStyle(.roundedBorder)
                    TextField(
                        "Resolved label", text: $store.doc.labels.resolved
                    )
                    .textFieldStyle(.roundedBorder)
                }
            }
            Section("Per-sender rules") {
                Text(
                    "Matched on the sender's address (display names never match). Rules steer the classifier only."
                )
                .font(.caption).foregroundColor(.secondary)
                ForEach($store.doc.instructions.rules) { $rule in
                    HStack(alignment: .top) {
                        TextField("@domain or address", text: $rule.match)
                            .textFieldStyle(.roundedBorder)
                            .frame(width: 170)
                        TextField(
                            "e.g. Always important.", text: $rule.note
                        )
                        .textFieldStyle(.roundedBorder)
                        Button {
                            store.removeRule(id: rule.id)
                        } label: {
                            Image(systemName: "minus.circle")
                        }
                        .buttonStyle(.plain)
                    }
                }
                Button {
                    store.addRule()
                } label: {
                    Label("Add rule", systemImage: "plus.circle")
                }
                .buttonStyle(.link)
            }
            Section("Model") {
                Picker("Provider", selection: $store.doc.llm.provider) {
                    Text("Anthropic").tag("anthropic")
                    Text("OpenAI").tag("openai")
                    Text("Google").tag("google")
                    Text("OpenAI-compatible (Ollama…)").tag("openai-compatible")
                }
                TextField("Model id", text: $store.doc.llm.model)
                    .textFieldStyle(.roundedBorder)
                Text(
                    "Switching provider needs its API key stored once: inboxminder set-key <provider>"
                )
                .font(.caption2).foregroundColor(.secondary)
            }
            Section("Daemon") {
                Stepper(
                    "Poll interval: \(store.doc.email.pollIntervalSec)s",
                    value: $store.doc.email.pollIntervalSec, in: 10...600,
                    step: 5)
                Toggle(
                    "Notify on Important mail",
                    isOn: $store.doc.email.notifications)
                VStack(alignment: .leading, spacing: 4) {
                    Text("Skip senders (comma-separated address substrings)")
                        .font(.caption).foregroundColor(.secondary)
                    TextField("mailer-daemon", text: $store.skipSendersText)
                        .textFieldStyle(.roundedBorder)
                }
            }
        }
        .formStyle(.grouped)
        .padding(.horizontal, -16)
    }

    private var footer: some View {
        HStack {
            Spacer()
            if case .editing = store.phase {
                Button("Save") { store.save() }
                    .keyboardShortcut(.defaultAction)
                    .disabled(store.busy)
            } else if case .saving = store.phase {
                Text("Saving…").font(.caption).foregroundColor(.secondary)
            }
        }
    }
}
