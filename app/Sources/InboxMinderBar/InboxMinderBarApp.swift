import AppKit
import InboxMinderBarCore
import SwiftUI

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
