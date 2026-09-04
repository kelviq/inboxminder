import AppKit
import InboxMinderBarCore
import Sparkle
import SwiftUI

/// Sparkle updater, app-wide. Only armed when running from the real bundle
/// (dev `swift run` has no Info.plist feed keys — the updater would just
/// log errors). Checks follow Sparkle's consent flow: the user is ASKED
/// before any automatic checking begins; nothing installs silently.
enum Updater {
    static let controller: SPUStandardUpdaterController? = {
        guard Bundle.main.bundleIdentifier == "com.inboxminder.menubar" else {
            return nil
        }
        return SPUStandardUpdaterController(
            startingUpdater: true, updaterDelegate: nil,
            userDriverDelegate: nil)
    }()

    static func checkForUpdates() {
        NSApp.activate(ignoringOtherApps: true)
        controller?.checkForUpdates(nil)
    }
}

/// The brand leaf as a menu-bar template image (black + alpha; macOS
/// recolors it for light/dark/selected). Loaded from the bundle — absent
/// in dev `swift run`, where the SF Symbol fallback renders instead.
enum MenuBarIcon {
    static let template: NSImage? = {
        guard
            let url = Bundle.main.url(
                forResource: "MenuIcon@2x", withExtension: "png"),
            let img = NSImage(contentsOf: url)
        else { return nil }
        img.isTemplate = true
        img.size = NSSize(width: 18, height: 18)
        return img
    }()
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        // Menu-bar-only app: no Dock icon, no app switcher entry. Set
        // programmatically so it holds both from the bundled .app
        // (belt-and-braces with LSUIElement) and from a bare `swift run`
        // executable during development.
        NSApp.setActivationPolicy(.accessory)
    }
}

@main
struct InboxMinderBarApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @StateObject private var profiles = ProfilesStore()

    var body: some Scene {
        MenuBarExtra {
            PopoverRootView(profiles: profiles)
        } label: {
            // The brand leaf while all is well; template SF Symbols for
            // the states that need to LOOK different at a glance (paused,
            // setup, attention). Worst state across profiles wins. The
            // label is the one view alive from launch, so it also hosts
            // the first-run gate (plan 053).
            MenuBarLabelView(profiles: profiles)
        }
        .menuBarExtraStyle(.window)

        // First-run wizard (plan 053) — auto-opened on a fresh default
        // profile, reachable again from the popover's setup states.
        Window("Welcome to InboxMinder", id: "onboarding") {
            OnboardingView()
        }
        .windowResizability(.contentSize)

        // Per-profile Preferences — the value is the profile name, "" for
        // the default profile (openWindow can't carry nil).
        WindowGroup("Preferences", id: "preferences", for: String.self) {
            $key in
            PreferencesView(profile: (key?.isEmpty ?? true) ? nil : key)
        }
        .windowResizability(.contentSize)
    }
}
