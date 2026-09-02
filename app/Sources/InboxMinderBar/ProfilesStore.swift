import Combine
import InboxMinderBarCore
import Foundation

/// Owns one StatusStore per discovered profile. Discovery is
/// filesystem-only (InboxMinderPaths.discoverProfiles) and re-runs on a 30s
/// timer, on popover opens (refreshAll), and on writes to the base
/// `profiles/` directory — an added or removed profile appears/disappears
/// without an app restart. Existing stores are kept across reconciles so
/// their directory watches and optimistic pause state survive.
final class ProfilesStore: ObservableObject {
    @Published private(set) var stores: [StatusStore]

    private var timer: Timer?
    private var dirSource: DispatchSourceFileSystemObject?
    private var cancellables: [AnyCancellable] = []

    init() {
        stores = ProfilesStore.reconcile(existing: [])
        rewire()
        timer = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) {
            [weak self] _ in
            DispatchQueue.main.async { self?.rediscover() }
        }
        watchProfilesDir()
    }

    deinit { dirSource?.cancel() }

    /// The default store — always present (discovery always lists it).
    var defaultStore: StatusStore { stores[0] }

    var iconSymbol: String {
        IconState.symbol(for: stores.map(\.derived))
    }

    func refreshAll() {
        rediscover()
        for store in stores { store.refresh() }
    }

    private func rediscover() {
        let next = ProfilesStore.reconcile(existing: stores)
        if next.map(\.paths.profile) != stores.map(\.paths.profile) {
            stores = next
            rewire()
        }
        if dirSource == nil { watchProfilesDir() }
    }

    private static func reconcile(existing: [StatusStore]) -> [StatusStore] {
        var byProfile = [String?: StatusStore]()
        for store in existing { byProfile[store.paths.profile] = store }
        return InboxMinderPaths.discoverProfiles().map { paths in
            byProfile[paths.profile] ?? StatusStore(paths: paths)
        }
    }

    /// Child ObservableObjects don't bubble into SwiftUI on their own —
    /// forward each store's change signal so the icon re-derives.
    private func rewire() {
        cancellables = stores.map { store in
            store.objectWillChange.sink { [weak self] _ in
                self?.objectWillChange.send()
            }
        }
    }

    private func watchProfilesDir() {
        // Watch the base profiles/ dir so creating/removing a profile
        // triggers rediscovery. The dir may not exist yet (no named
        // profiles) — the timer keeps retrying until it does.
        let dir = InboxMinderPaths().baseDataDir.appendingPathComponent("profiles")
        let fd = open(dir.path, O_EVTONLY)
        guard fd >= 0 else { return }
        let source = DispatchSource.makeFileSystemObjectSource(
            fileDescriptor: fd, eventMask: [.write, .delete], queue: .main)
        source.setEventHandler { [weak self] in self?.rediscover() }
        source.setCancelHandler { close(fd) }
        source.resume()
        dirSource = source
    }
}
