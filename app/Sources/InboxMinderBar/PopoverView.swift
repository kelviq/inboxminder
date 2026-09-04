import AppKit
import InboxMinderBarCore
import SwiftUI

/// One profile's surface. Standalone (the whole popover) or `embedded` as
/// a section of the multi-profile popover: section header, tighter
/// activity cap, app-level menu items lifted to the wrapper. Renders
/// `store.derived` and delegates every mutation to the CLI. Reviewer
/// rules: no network, no Keychain, no direct DB access, no daemon logic.
struct PopoverView: View {
    @ObservedObject var store: StatusStore
    var embedded = false
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        if embedded {
            VStack(alignment: .leading, spacing: 10) {
                sectionHeader
                inner
            }
            .padding(10)
            .background(
                RoundedRectangle(cornerRadius: 10)
                    .fill(Color.primary.opacity(0.03))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 10)
                    .stroke(Color.primary.opacity(0.08))
            )
        } else {
            VStack(alignment: .leading, spacing: 0) {
                inner
            }
            .frame(width: 340)
            .onAppear { store.refresh() }
        }
    }

    @ViewBuilder private var inner: some View {
        header
            .padding(.horizontal, embedded ? 0 : 16)
            .padding(.top, embedded ? 0 : 14)
            .padding(.bottom, 10)
        if store.derived.reauthNeeded {
            reauthBanner
                .padding(.horizontal, embedded ? 0 : 16)
                .padding(.bottom, 8)
        }
        if store.agentUpdatePending, !embedded {
            agentUpdateBanner
                .padding(.horizontal, 16)
                .padding(.bottom, 8)
        }
        content
        if let update = store.derived.status?.updateAvailable, !embedded {
            updateBanner(update)
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
        }
        if !embedded { Divider() }
        footer
            .padding(.horizontal, embedded ? 0 : 12)
            .padding(.vertical, embedded ? 0 : 8)
    }

    // MARK: header

    private var sectionHeader: some View {
        HStack(alignment: .firstTextBaseline) {
            Text(store.paths.profile ?? "default").font(.subheadline).bold()
            Spacer()
            Text(store.derived.status?.selfEmail ?? "")
                .font(.caption2).foregroundColor(.secondary).lineLimit(1)
        }
    }

    private var header: some View {
        HStack(alignment: .center, spacing: 10) {
            Circle()
                .fill(statusColor)
                .frame(width: 9, height: 9)
                .shadow(color: statusColor.opacity(0.5), radius: 3)
            VStack(alignment: .leading, spacing: 1) {
                Text(statusTitle)
                    .font(embedded ? .callout.weight(.semibold) : .headline)
                Text(statusSubtitle)
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .lineLimit(1)
            }
            Spacer()
            pauseToggle
            overflowMenu
        }
    }

    private var statusColor: Color {
        if store.derived.reauthNeeded { return .red }
        switch store.derived.run {
        case .ok: return .green
        case .paused: return .yellow
        case .setupNeededNoConfig, .setupNeededNoAgent: return .secondary.opacity(0.6)
        case .stalled, .notRunning, .notReporting: return .red
        }
    }

    private var statusTitle: String {
        switch store.derived.run {
        case .setupNeededNoConfig: return "Welcome to InboxMinder"
        case .setupNeededNoAgent: return "Almost there"
        case .notReporting: return "Agent out of date"
        case .notRunning: return "Agent not running"
        case .stalled: return "Agent stalled"
        case .paused:
            return store.pendingPause == false ? "Resuming…" : "Paused"
        case .ok:
            return store.pendingPause == true ? "Pausing…" : "Watching"
        }
    }

    private var statusSubtitle: String {
        let email = store.derived.status?.selfEmail ?? ""
        switch store.derived.run {
        case .setupNeededNoConfig: return "Two minutes to your first triage"
        case .setupNeededNoAgent: return "Config found; install the agent"
        case .notReporting: return "Running an older build"
        case .notRunning: return "launchd shows no live process"
        case .stalled(let age):
            return "Last heartbeat \(AgeFormat.short(ms: age)) ago"
        case .paused: return "Mail waits; nothing is lost"
        case .ok(let age):
            let tick = "Checked \(AgeFormat.short(ms: age)) ago"
            return email.isEmpty ? tick : "\(tick) · \(email)"
        }
    }

    /// Every header icon renders through this — identical size, weight,
    /// rendering mode, and hit box, so the pair can never look mismatched.
    private func headerIcon(_ symbol: String) -> some View {
        Image(systemName: symbol)
            .font(.system(size: 15, weight: .medium))
            .symbolRenderingMode(.monochrome)
            .foregroundColor(.secondary)
            .frame(width: 24, height: 24)
            .contentShape(Rectangle())
    }

    @ViewBuilder private var pauseToggle: some View {
        switch store.derived.run {
        case .ok, .paused, .stalled:
            Button {
                store.setPaused(store.derived.run == .paused ? false : true)
            } label: {
                headerIcon(
                    store.derived.run == .paused
                        ? "play.circle" : "pause.circle")
            }
            .buttonStyle(.plain)
            .disabled(store.pendingPause != nil || store.cli == nil)
            .help(
                store.derived.run == .paused
                    ? "Resume watching" : "Pause watching")
        default:
            EmptyView()
        }
    }

    private var overflowMenu: some View {
        Menu {
            Button("Preferences…") {
                NSApp.activate(ignoringOtherApps: true)
                openWindow(id: "preferences", value: store.paths.profile ?? "")
            }
            Button("Reinstall agent") { store.reinstallAgent() }
            if !embedded {
                // App-level items; in embedded mode the multi-profile
                // wrapper's footer owns them.
                Divider()
                Button("Check for updates…") { Updater.checkForUpdates() }
                    .disabled(Updater.controller == nil)
                Divider()
                Button("Quit Menu Bar") {
                    NSApplication.shared.terminate(nil)
                }
                .help("Closes this app; the gatekeeper daemon keeps running")
                Button("Quit Completely") {
                    store.stopAgent()
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) {
                        NSApplication.shared.terminate(nil)
                    }
                }
                .help("Stops the gatekeeper daemon too; nothing watches until you run inboxminder up")
            }
        } label: {
            headerIcon("ellipsis.circle")
        }
        .menuStyle(.borderlessButton)
        .menuIndicator(.hidden)
        .fixedSize()
    }

    // MARK: body per state

    @ViewBuilder private var content: some View {
        switch store.derived.run {
        case .setupNeededNoConfig:
            // With a bundled runtime the wizard is the setup path (plan
            // 053); the terminal command is the from-source fallback.
            if Self.wizardAvailable {
                wizardHint("Set up InboxMinder in about five minutes.")
            } else {
                setupHint(
                    "One command in your terminal starts the guided setup:",
                    command: "inboxminder init")
            }
        case .setupNeededNoAgent:
            if Self.wizardAvailable {
                wizardHint("Config found. Finish setup to go live.")
            } else {
                setupHint(
                    "Your config is ready; this installs the background agent:",
                    command: "inboxminder up")
            }
        case .notReporting:
            hintText(
                "The agent predates this app. Rebuild it, then choose "
                    + "Reinstall agent from the … menu.")
        case .notRunning:
            hintText(
                "Check ~/.inboxminder/logs/watch.err.log, then choose "
                    + "Reinstall agent from the … menu.")
        case .stalled, .paused, .ok:
            activityList
        }
    }

    private func hintText(_ text: String) -> some View {
        Text(text)
            .font(.callout).foregroundColor(.secondary)
            .padding(.horizontal, embedded ? 0 : 16)
            .padding(.bottom, 10)
    }

    static let wizardAvailable = BundledRuntime.fromMainBundle() != nil

    private func wizardHint(_ text: String) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(text).font(.callout).foregroundColor(.secondary)
            Button {
                openWindow(id: "onboarding")
                NSApp.activate(ignoringOtherApps: true)
            } label: {
                Text("Finish Setting Up…")
                    .font(.callout.weight(.semibold))
                    .frame(maxWidth: .infinity)
            }
            .controlSize(.large)
            .buttonStyle(.borderedProminent)
            .tint(Color(red: 1.0, green: 0.27, blue: 0.0))
            .keyboardShortcut(.defaultAction)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, embedded ? 0 : 16)
        .padding(.bottom, 12)
    }

    private func setupHint(_ text: String, command: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(text).font(.callout).foregroundColor(.secondary)
            HStack(spacing: 8) {
                Text(command)
                    .font(.system(.callout, design: .monospaced))
                Spacer()
                Button {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(command, forType: .string)
                } label: {
                    Image(systemName: "doc.on.doc")
                }
                .buttonStyle(.plain)
                .foregroundColor(.secondary)
                .help("Copy command")
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .background(
                RoundedRectangle(cornerRadius: 8)
                    .fill(Color.primary.opacity(0.05))
            )
        }
        .padding(.horizontal, embedded ? 0 : 16)
        .padding(.bottom, 12)
    }

    private var reauthBanner: some View {
        HStack(spacing: 8) {
            Image(systemName: "key.fill").foregroundColor(.orange)
            VStack(alignment: .leading, spacing: 0) {
                Text("Gmail needs re-authorization").font(.callout.weight(.medium))
                Text("Watching is on hold until then")
                    .font(.caption2).foregroundColor(.secondary)
            }
            Spacer()
            Button("Fix now") { store.reauthorize() }
                .controlSize(.small)
        }
        .padding(10)
        .background(
            RoundedRectangle(cornerRadius: 8).fill(Color.orange.opacity(0.12))
        )
    }

    /// D5: the app updated; one click restarts the agent onto the new
    /// bundled code.
    private var agentUpdateBanner: some View {
        HStack(spacing: 8) {
            Image(systemName: "arrow.triangle.2.circlepath")
                .foregroundColor(.secondary)
            Text("InboxMinder updated; restart the agent to apply")
                .font(.caption)
                .foregroundColor(.secondary)
            Spacer()
            Button("Apply") { store.reinstallAgent() }
                .controlSize(.small)
        }
        .padding(8)
        .background(
            RoundedRectangle(cornerRadius: 8).fill(Color.blue.opacity(0.10))
        )
    }

    private func updateBanner(_ version: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "sparkles")
                .foregroundColor(.secondary)
            Text("Version \(version) is available")
                .font(.caption)
                .foregroundColor(.secondary)
            Spacer()
            Button("Update") { Updater.checkForUpdates() }
                .controlSize(.small)
                .disabled(Updater.controller == nil)
        }
    }

    // MARK: activity feed

    @ViewBuilder private var activityList: some View {
        // Embedded sections cap tighter so a multi-product popover stays
        // scannable.
        let items = Array(
            (store.derived.status?.activity ?? []).prefix(embedded ? 8 : 20))
        VStack(alignment: .leading, spacing: 4) {
            Text("RECENT ACTIVITY")
                .font(.caption2.weight(.semibold))
                .foregroundColor(.secondary.opacity(0.8))
                .kerning(0.6)
                .padding(.horizontal, embedded ? 0 : 16)
            if items.isEmpty {
                HStack(spacing: 8) {
                    Image(systemName: "tray")
                        .foregroundColor(.secondary.opacity(0.6))
                    Text("Quiet so far; triaged mail will appear here.")
                        .font(.caption).foregroundColor(.secondary)
                }
                .padding(.horizontal, embedded ? 0 : 16)
                .padding(.vertical, 12)
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        ForEach(Array(items.enumerated()), id: \.offset) {
                            _, item in
                            ActivityRow(
                                item: item,
                                selfEmail: store.derived.status?.selfEmail
                                    ?? "",
                                inset: embedded ? 0 : 10)
                        }
                    }
                    .padding(.horizontal, embedded ? 0 : 6)
                }
                .frame(maxHeight: embedded ? 150 : 280)
            }
        }
        .padding(.bottom, 8)
    }

    // MARK: footer

    private var footer: some View {
        HStack(spacing: 2) {
            footerAction("envelope", "Gmail") {
                if let url = GmailLinks.inbox(
                    selfEmail: store.derived.status?.selfEmail ?? "")
                {
                    NSWorkspace.shared.open(url)
                }
            }
            footerAction("slider.horizontal.3", "Preferences") {
                NSApp.activate(ignoringOtherApps: true)
                openWindow(id: "preferences", value: store.paths.profile ?? "")
            }
            footerAction("doc.badge.gearshape", "Config") {
                openFile(store.paths.configToml)
            }
            footerAction("text.alignleft", "Log") {
                openFile(store.paths.watchLog)
            }
            Spacer()
        }
    }

    private func footerAction(
        _ symbol: String, _ title: String, action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 4) {
                Image(systemName: symbol).font(.system(size: 11))
                Text(title).font(.caption)
            }
            .foregroundColor(.secondary)
            .padding(.horizontal, 8)
            .padding(.vertical, 5)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHoverHighlight()
    }

    private func openFile(_ url: URL) {
        NSWorkspace.shared.open(url)
    }
}

// MARK: - activity row

struct ActivityRow: View {
    let item: StatusFile.ActivityItem
    let selfEmail: String
    var inset: CGFloat = 10
    @State private var hovering = false

    var body: some View {
        HStack(alignment: .center, spacing: 10) {
            ZStack {
                Circle().fill(tint.opacity(0.15)).frame(width: 26, height: 26)
                Image(systemName: symbol)
                    .font(.system(size: 11, weight: .medium))
                    .foregroundColor(tint)
            }
            VStack(alignment: .leading, spacing: 1) {
                Text(title).font(.callout).lineLimit(1)
                Text(subtitle).font(.caption2).foregroundColor(.secondary)
                    .lineLimit(1)
            }
            Spacer(minLength: 4)
            if hovering, let url = GmailLinks.best(item: item, selfEmail: selfEmail) {
                Button {
                    NSWorkspace.shared.open(url)
                } label: {
                    Image(systemName: "arrow.up.forward")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundColor(.secondary)
                }
                .buttonStyle(.plain)
                .help("Open in Gmail")
            } else {
                Text(relativeTime)
                    .font(.caption2)
                    .foregroundColor(.secondary.opacity(0.7))
                    .monospacedDigit()
            }
        }
        .padding(.horizontal, inset)
        .padding(.vertical, 6)
        .background(
            RoundedRectangle(cornerRadius: 8)
                .fill(hovering ? Color.primary.opacity(0.06) : .clear)
        )
        .onHover { hovering = $0 }
    }

    private var title: String {
        item.subject ?? item.detail ?? item.kind
    }

    /// The category rides in `detail` ("cold-outreach", "marketing ·
    /// archived", …); split off any annotation after "·".
    private var category: String {
        (item.detail ?? "").split(separator: "·").first.map {
            $0.trimmingCharacters(in: .whitespaces)
        } ?? ""
    }

    private var archived: Bool { (item.detail ?? "").contains("archived") }

    private var subtitle: String {
        switch item.kind {
        case "important": return "Marked important"
        case "reauth": return "Gmail authorization expired"
        case "labeled":
            let name = categoryDisplay.isEmpty ? "Labeled" : categoryDisplay
            return archived ? "\(name) · archived" : name
        default: return item.kind
        }
    }

    private var categoryDisplay: String {
        switch category {
        case "newsletter": return "Newsletter"
        case "notification": return "Notification"
        case "marketing": return "Marketing"
        case "cold-outreach": return "Cold outreach"
        case "fyi": return "FYI"
        default: return category
        }
    }

    private var relativeTime: String {
        AgeFormat.short(
            ms: max(0, Date().timeIntervalSince1970 * 1000 - item.at))
    }

    private var tint: Color {
        switch item.kind {
        case "important": return .orange
        case "reauth": return .red
        default:
            switch category {
            case "newsletter": return .indigo
            case "notification": return .secondary
            case "marketing": return .purple
            case "cold-outreach": return .pink
            case "fyi": return .teal
            default: return .secondary
            }
        }
    }

    private var symbol: String {
        switch item.kind {
        case "important": return "exclamationmark.circle.fill"
        case "reauth": return "key.fill"
        default:
            switch category {
            case "newsletter": return "newspaper"
            case "notification": return "bell"
            case "marketing": return "megaphone"
            case "cold-outreach": return "snowflake"
            case "fyi": return "info.circle"
            default: return "tag"
            }
        }
    }
}

// MARK: - helpers

private struct HoverHighlight: ViewModifier {
    @State private var hovering = false
    func body(content: Content) -> some View {
        content
            .background(
                RoundedRectangle(cornerRadius: 6)
                    .fill(hovering ? Color.primary.opacity(0.06) : .clear)
            )
            .onHover { hovering = $0 }
    }
}

extension View {
    fileprivate func onHoverHighlight() -> some View {
        modifier(HoverHighlight())
    }
}
