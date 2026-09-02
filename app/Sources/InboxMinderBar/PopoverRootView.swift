import AppKit
import InboxMinderBarCore
import SwiftUI

/// The popover's entry. One profile → exactly the plain PopoverView, zero
/// new chrome. Several → one embedded section per profile plus an
/// app-level footer (Quit).
struct PopoverRootView: View {
    @ObservedObject var profiles: ProfilesStore

    var body: some View {
        if profiles.stores.count <= 1 {
            PopoverView(store: profiles.defaultStore)
                .onAppear { profiles.refreshAll() }
        } else {
            VStack(alignment: .leading, spacing: 10) {
                ForEach(profiles.stores, id: \.paths.launchdLabel) { store in
                    PopoverView(store: store, embedded: true)
                }
                Divider()
                footer
            }
            .padding(12)
            .frame(width: 340)
            .onAppear { profiles.refreshAll() }
        }
    }

    private var footer: some View {
        HStack {
            Spacer()
            Button("Quit (daemons keep running)") {
                NSApplication.shared.terminate(nil)
            }
            .buttonStyle(.link)
        }
        .font(.caption)
    }
}
