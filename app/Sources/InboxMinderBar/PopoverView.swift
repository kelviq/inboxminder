import AppKit
import InboxMinderBarCore
import SwiftUI

/// One profile's surface. Standalone (the whole popover — pre-030 layout,
/// unchanged for single-profile machines) or `embedded` as a section of
/// the multi-profile popover: section header, tighter activity
/// cap, app-level menu items lifted to the wrapper. Renders `store.derived`
/// and delegates every mutation to the CLI. Reviewer rules: no
/// network, no Keychain, no direct DB access, no daemon logic.
struct PopoverView: View {
    @ObservedObject var store: StatusStore
    var embedded = false
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        if embedded {
            VStack(alignment: .leading, spacing: 8) {
                sectionHeader
                inner
            }
            .padding(8)
            .overlay(
                RoundedRectangle(cornerRadius: 6)
                    .stroke(Color.secondary.opacity(0.25))
            )
        } else {
            VStack(alignment: .leading, spacing: 10) {
                inner
            }
            .padding(12)
            .frame(width: 320)
            .onAppear { store.refresh() }
        }
    }

    @ViewBuilder private var inner: some View {
        header
        if store.derived.reauthNeeded { reauthBanner }
        content
        if let update = store.derived.status?.updateAvailable, !embedded {
            HStack(spacing: 6) {
                Image(systemName: "arrow.down.circle")
                    .foregroundColor(.secondary)
                Text("Update available: \(update)").font(.caption)
                Spacer()
                Button("Releases") {
                    if let url = URL(
                        string:
                            "https://github.com/kelviq/inboxminder/releases")
                    {
                        NSWorkspace.shared.open(url)
                    }
                }
                .buttonStyle(.link).font(.caption)
            }
        }
        Divider()
        footer
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
        HStack {
            Text(statusLine)
                .font(embedded ? .callout : .headline)
            Spacer()
            overflowMenu
        }
    }

    private var statusLine: String {
        switch store.derived.run {
        case .setupNeededNoConfig: return "InboxMinder isn't set up"
        case .setupNeededNoAgent: return "Daemon not installed"
        case .notReporting: return "Daemon not reporting"
        case .notRunning: return "Agent not running"
        case .stalled(let age):
            return "STALLED — last tick \(AgeFormat.short(ms: age)) ago"
        case .paused:
            return store.pendingPause == false ? "Resuming…" : "Paused"
        case .ok(let age):
            return store.pendingPause == true
                ? "Pausing…"
                : "Watching — last tick \(AgeFormat.short(ms: age)) ago"
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
                Button("Quit InboxMinder Menu Bar (daemon keeps running)") {
                    NSApplication.shared.terminate(nil)
                }
            }
        } label: {
            Image(systemName: "ellipsis.circle")
        }
        .menuStyle(.borderlessButton)
        .frame(width: 24)
    }

    // MARK: body per state

    @ViewBuilder private var content: some View {
        switch store.derived.run {
        case .setupNeededNoConfig:
            setupHint(
                "Run this in a terminal to set up InboxMinder:",
                command: "inboxminder init")
        case .setupNeededNoAgent:
            setupHint(
                "Config found, but the background agent isn't installed:",
                command: "inboxminder up")
        case .notReporting:
            Text(
                "The agent is installed but writes no status file — "
                    + "it may be running a build older than the app. "
                    + "Reinstall it from the … menu after `pnpm build`."
            )
            .font(.callout).foregroundColor(.secondary)
        case .notRunning:
            Text(
                "launchd shows no live process. Check "
                    + "~/.inboxminder/logs/watch.err.log, then reinstall "
                    + "from the … menu."
            )
            .font(.callout).foregroundColor(.secondary)
        case .stalled, .paused, .ok:
            pauseButton
            activityList
        }
    }

    private func setupHint(_ text: String, command: String) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(text).font(.callout).foregroundColor(.secondary)
            HStack {
                Text(command).font(.system(.body, design: .monospaced))
                Button("Copy") {
                    NSPasteboard.general.clearContents()
                    NSPasteboard.general.setString(command, forType: .string)
                }
            }
        }
    }

    private var reauthBanner: some View {
        HStack {
            Image(systemName: "key.fill").foregroundColor(.orange)
            Text("Gmail authorization expired").font(.callout)
            Spacer()
            Button("Re-authorize") { store.reauthorize() }
        }
        .padding(6)
        .background(Color.orange.opacity(0.15))
        .cornerRadius(6)
    }

    private var pauseButton: some View {
        HStack {
            if store.derived.run == .paused {
                Button("Resume watching") { store.setPaused(false) }
                Text("Mail arriving now is triaged on resume")
                    .font(.caption).foregroundColor(.secondary)
            } else {
                Button("Pause watching") { store.setPaused(true) }
            }
        }
        .disabled(store.pendingPause != nil || store.cli == nil)
    }

    // MARK: activity feed

    @ViewBuilder private var activityList: some View {
        // Embedded sections cap tighter so a multi-product popover stays
        // scannable.
        let items = Array(
            (store.derived.status?.activity ?? []).prefix(embedded ? 10 : 20))
        if items.isEmpty {
            Text("No activity yet — triaged mail will show here.")
                .font(.caption).foregroundColor(.secondary)
        } else {
            ScrollView {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                        ActivityRow(
                            item: item,
                            selfEmail: store.derived.status?.selfEmail ?? "")
                    }
                }
            }
            .frame(maxHeight: embedded ? 140 : 260)
        }
    }

    // MARK: footer

    private var footer: some View {
        HStack(spacing: 10) {
            footerLink("Gmail") {
                if let url = GmailLinks.inbox(
                    selfEmail: store.derived.status?.selfEmail ?? "")
                {
                    NSWorkspace.shared.open(url)
                }
            }
            footerLink("Config") { openFile(store.paths.configToml) }
            footerLink("Instructions") { openFile(store.paths.instructionsMd) }
            footerLink("Log") { openFile(store.paths.watchLog) }
            Spacer()
        }
        .font(.caption)
    }

    private func footerLink(_ title: String, action: @escaping () -> Void)
        -> some View
    {
        Button(title, action: action).buttonStyle(.link)
    }

    private func openFile(_ url: URL) {
        NSWorkspace.shared.open(url)
    }
}

struct ActivityRow: View {
    let item: StatusFile.ActivityItem
    let selfEmail: String

    var body: some View {
        HStack(alignment: .top, spacing: 6) {
            Image(systemName: symbol)
                .frame(width: 14)
                .foregroundColor(.secondary)
            VStack(alignment: .leading, spacing: 1) {
                Text(title).font(.callout).lineLimit(1)
                Text(subtitle).font(.caption2).foregroundColor(.secondary)
            }
            Spacer()
            if let url = GmailLinks.best(item: item, selfEmail: selfEmail) {
                Button {
                    NSWorkspace.shared.open(url)
                } label: {
                    Image(systemName: "arrow.up.right.square")
                }
                .buttonStyle(.plain)
                .foregroundColor(.secondary)
                .help("Open in Gmail")
            } else if let path = item.path, !path.isEmpty {
                // Docs rows: open the written file — the daemon supplies the
                // absolute path; the app resolves nothing.
                Button {
                    NSWorkspace.shared.open(URL(fileURLWithPath: path))
                } label: {
                    Image(systemName: "doc.text.magnifyingglass")
                }
                .buttonStyle(.plain)
                .foregroundColor(.secondary)
                .help("Open file")
            }
        }
    }

    private var title: String {
        item.subject ?? item.detail ?? item.kind
    }

    private var subtitle: String {
        var parts: [String] = [label]
        if let detail = item.detail, item.subject != nil { parts.append(detail) }
        parts.append(relativeTime)
        return parts.joined(separator: " · ")
    }

    private var relativeTime: String {
        let date = Date(timeIntervalSince1970: item.at / 1000)
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .abbreviated
        return formatter.localizedString(for: date, relativeTo: Date())
    }

    private var label: String {
        switch item.kind {
        case "labeled": return "Labeled"
        case "important": return "Important"
        case "reauth": return "Re-auth needed"
        default: return item.kind
        }
    }

    private var symbol: String {
        switch item.kind {
        case "labeled": return "tag"
        case "important": return "exclamationmark.circle"
        case "reauth": return "key"
        default: return "circle"
        }
    }
}
