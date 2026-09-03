import AppKit
import InboxMinderBarCore
import SwiftUI

/// Per-profile Preferences window. Renders and delegates — every write
/// goes through the CLI settings funnel; the app never edits config.toml
/// directly.
struct PreferencesView: View {
    @StateObject private var store: PreferencesStore
    @Environment(\.dismiss) private var dismiss
    @State private var tab: Tab = .gatekeeper

    enum Tab: Hashable { case gatekeeper, rules, model, general }

    init(profile: String?) {
        _store = StateObject(wrappedValue: PreferencesStore(profile: profile))
    }

    var body: some View {
        VStack(spacing: 0) {
            content
            if let error = store.errorText {
                Text(error)
                    .font(.caption).foregroundColor(.red)
                    .textSelection(.enabled).lineLimit(4)
                    .padding(.horizontal, 16)
                    .padding(.bottom, 8)
            }
            Divider()
            footer
        }
        .frame(width: 560, height: 520)
    }

    @ViewBuilder private var content: some View {
        switch store.phase {
        case .loading:
            Spacer()
            ProgressView("Loading settings…")
                .controlSize(.small)
            Spacer()
        case .failed(let message):
            Spacer()
            VStack(spacing: 8) {
                Image(systemName: "exclamationmark.triangle")
                    .font(.system(size: 24))
                    .foregroundColor(.secondary)
                Text(message)
                    .font(.callout).foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
                    .textSelection(.enabled)
                    .frame(maxWidth: 380)
            }
            Spacer()
        case .saved:
            Spacer()
            savedState
            Spacer()
        case .editing, .saving:
            tabs
        }
    }

    private var savedState: some View {
        VStack(spacing: 12) {
            Image(systemName: "checkmark.seal.fill")
                .font(.system(size: 32))
                .foregroundColor(.green)
            Text("Settings saved").font(.headline)
            Text("The running agent keeps its old values until it restarts.")
                .font(.callout).foregroundColor(.secondary)
            HStack(spacing: 10) {
                Button("Apply and Restart Agent") {
                    store.restartAgent()
                    dismiss()
                }
                .keyboardShortcut(.defaultAction)
                Button("Later") { dismiss() }
            }
            .padding(.top, 4)
        }
    }

    // MARK: tabs

    private var tabs: some View {
        TabView(selection: $tab) {
            gatekeeperTab
                .tabItem {
                    Label("Gatekeeper", systemImage: "shield.lefthalf.filled")
                }
                .tag(Tab.gatekeeper)
            rulesTab
                .tabItem {
                    Label("Rules", systemImage: "person.text.rectangle")
                }
                .tag(Tab.rules)
            modelTab
                .tabItem { Label("Model", systemImage: "cpu") }
                .tag(Tab.model)
            generalTab
                .tabItem { Label("General", systemImage: "gearshape") }
                .tag(Tab.general)
        }
        .padding(.top, 8)
    }

    /// `.formStyle(.grouped)` is load-bearing (macOS 13+): the default
    /// `.columns` style right-aligns labels into a phantom column and
    /// clips at fixed frames. Grouped forms left-align and scroll.
    private var gatekeeperTab: some View {
        Form {
            Section {
                Toggle(isOn: $store.doc.triage.enabled) {
                    Text("Triage every email")
                    Text(
                        "One classifier call per email; categories, importance, reply tracking"
                    )
                }
            }
            Section("Skip the inbox") {
                Text(
                    "Opted-in categories are archived on arrival; the label always stays, so nothing is ever lost."
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
            Section("Cold outreach") {
                VStack(alignment: .leading, spacing: 4) {
                    Text("What counts as warm?")
                    TextField(
                        "", text: $store.doc.triage.coldOutreachHint,
                        prompt: Text(
                            "e.g. founders asking about my product are never cold"
                        ),
                        axis: .vertical
                    )
                    .labelsHidden()
                    .textFieldStyle(.roundedBorder)
                    .lineLimit(2...3)
                    Text(
                        "Anyone you've ever written to is never labeled cold, regardless."
                    )
                    .font(.caption).foregroundColor(.secondary)
                }
            }
            .disabled(!store.doc.triage.enabled)
            Section("Label names") {
                labelField("Newsletters", $store.doc.triage.labels.newsletter)
                labelField(
                    "Notifications", $store.doc.triage.labels.notification)
                labelField("Marketing", $store.doc.triage.labels.marketing)
                labelField(
                    "Cold outreach", $store.doc.triage.labels.coldOutreach)
                labelField("FYI", $store.doc.triage.labels.fyi)
                labelField("Important", $store.doc.triage.labels.important)
                Text("A \u{201C}/\u{201D} nests labels in Gmail's sidebar.")
                    .font(.caption).foregroundColor(.secondary)
            }
            .disabled(!store.doc.triage.enabled)
        }
        .formStyle(.grouped)
    }

    private var rulesTab: some View {
        Form {
            Section {
                Text(
                    "Rules steer the classifier for specific senders; \u{201C}always important\u{201D}, \u{201C}never worth a reply\u{201D}. Matched on the address only; display names are spoofable and never match."
                )
                .font(.caption).foregroundColor(.secondary)
            }
            Section {
                if store.doc.instructions.rules.isEmpty {
                    HStack(spacing: 8) {
                        Image(systemName: "person.text.rectangle")
                            .foregroundColor(.secondary.opacity(0.6))
                        Text("No rules yet")
                            .foregroundColor(.secondary)
                    }
                    .padding(.vertical, 4)
                }
                ForEach($store.doc.instructions.rules) { $rule in
                    HStack(alignment: .center, spacing: 8) {
                        TextField(
                            "", text: $rule.match,
                            prompt: Text("@domain or address")
                        )
                        .labelsHidden()
                        .textFieldStyle(.roundedBorder)
                        .frame(width: 180)
                        TextField(
                            "", text: $rule.note,
                            prompt: Text("Always important.")
                        )
                        .labelsHidden()
                        .textFieldStyle(.roundedBorder)
                        Button {
                            store.removeRule(id: rule.id)
                        } label: {
                            Image(systemName: "minus.circle.fill")
                                .foregroundColor(.secondary)
                        }
                        .buttonStyle(.plain)
                        .help("Remove rule")
                    }
                }
                Button {
                    store.addRule()
                } label: {
                    Label("Add Rule", systemImage: "plus")
                }
            }
        }
        .formStyle(.grouped)
    }

    private var modelTab: some View {
        Form {
            Section {
                Picker("Provider", selection: $store.doc.llm.provider) {
                    Text("Anthropic").tag("anthropic")
                    Text("OpenAI").tag("openai")
                    Text("Google").tag("google")
                    Text("OpenAI-compatible").tag("openai-compatible")
                }
                HStack {
                    Text("Model")
                    Spacer()
                    TextField(
                        "", text: $store.doc.llm.model,
                        prompt: Text("claude-sonnet-5")
                    )
                    .labelsHidden()
                    .textFieldStyle(.roundedBorder)
                    .font(.body.monospaced())
                    .frame(width: 250)
                }
            } footer: {
                Text(
                    "Switching provider needs its API key stored once:  inboxminder set-key <provider>.  OpenAI-compatible covers Ollama and LM Studio for a fully local setup."
                )
                .font(.caption).foregroundColor(.secondary)
            }
        }
        .formStyle(.grouped)
    }

    private var generalTab: some View {
        Form {
            Section("Reply tracking") {
                Toggle(isOn: $store.doc.labels.enabled) {
                    Text("Pending and Resolved labels")
                    Text(
                        "Reply-worthy threads carry Pending until your reply goes out"
                    )
                }
                if store.doc.labels.enabled {
                    labelField("Pending", $store.doc.labels.pending)
                    labelField("Resolved", $store.doc.labels.resolved)
                }
            }
            Section("Daemon") {
                Stepper(
                    "Check mail every \(store.doc.email.pollIntervalSec)s",
                    value: $store.doc.email.pollIntervalSec, in: 10...600,
                    step: 5)
                Toggle(isOn: $store.doc.email.notifications) {
                    Text("Notifications")
                    Text(
                        "Important mail and re-auth only; subjects, never contents"
                    )
                }
                Toggle(isOn: $store.doc.email.updateCheck) {
                    Text("Check for new versions daily")
                    Text("Notify-only; it never installs anything itself")
                }
            }
            Section("Skip senders") {
                TextField(
                    "", text: $store.skipSendersText,
                    prompt: Text("mailer-daemon, noreply@"),
                    axis: .vertical
                )
                .labelsHidden()
                .textFieldStyle(.roundedBorder)
                .lineLimit(1...3)
                Text(
                    "Comma-separated address substrings that are never classified."
                )
                .font(.caption).foregroundColor(.secondary)
            }
        }
        .formStyle(.grouped)
    }

    private func labelField(_ title: String, _ binding: Binding<String>)
        -> some View
    {
        HStack {
            Text(title)
            Spacer()
            TextField("", text: binding, prompt: Text(title))
                .labelsHidden()
                .textFieldStyle(.roundedBorder)
                .frame(width: 250)
        }
    }

    // MARK: footer

    private var footer: some View {
        HStack {
            Text("Profile: \(store.paths.profile ?? "default")")
                .font(.caption).foregroundColor(.secondary)
            Spacer()
            if case .saving = store.phase {
                ProgressView().controlSize(.small)
                    .padding(.trailing, 6)
            }
            if case .editing = store.phase {
                Button("Save") { store.save() }
                    .keyboardShortcut(.defaultAction)
                    .disabled(store.busy)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 10)
    }
}
