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
            // Template SF Symbols so light/dark menu bars work for free.
            // Worst state across profiles wins (IconState) —
            // single-profile machines get the simple mapping.
            Image(systemName: profiles.iconSymbol)
        }
        .menuBarExtraStyle(.window)

        // Per-profile Preferences — the value is the profile name, "" for
        // the default profile (openWindow can't carry nil).
        WindowGroup("Preferences", id: "preferences", for: String.self) {
            $key in
            PreferencesView(profile: (key?.isEmpty ?? true) ? nil : key)
        }
        .windowResizability(.contentSize)
    }
}
