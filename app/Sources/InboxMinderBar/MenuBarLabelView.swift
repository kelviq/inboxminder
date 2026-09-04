import InboxMinderBarCore
import SwiftUI

/// The menu-bar glyph plus the app's launch-time gate: MenuBarExtra's
/// label is the only view guaranteed alive from startup, so it owns the
/// "fresh Mac → open the wizard" decision (plan 053). Fires at most
/// once per app run; the condition itself is derived from the
/// filesystem, so an already-set-up machine never sees the wizard
/// uninvited.
struct MenuBarLabelView: View {
    @ObservedObject var profiles: ProfilesStore
    @Environment(\.openWindow) private var openWindow
    @State private var gateChecked = false

    var body: some View {
        glyph.task {
            guard !gateChecked else { return }
            gateChecked = true
            // Wizard only when this build can actually drive setup —
            // a from-source build without the bundled runtime keeps
            // the popover's terminal hint instead.
            guard BundledRuntime.fromMainBundle() != nil else { return }
            let paths = InboxMinderPaths()
            let fm = FileManager.default
            if OnboardingProgress.isNeeded(
                configExists: fm.fileExists(atPath: paths.configToml.path),
                agentPlistExists: fm.fileExists(
                    atPath: paths.launchAgentPlist.path))
            {
                openWindow(id: "onboarding")
                NSApp.activate(ignoringOtherApps: true)
            }
        }
    }

    @ViewBuilder private var glyph: some View {
        if profiles.iconSymbol == "envelope",
            let leaf = MenuBarIcon.template
        {
            Image(nsImage: leaf)
        } else {
            Image(systemName: profiles.iconSymbol)
        }
    }
}
