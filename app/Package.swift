// swift-tools-version: 5.7
// Tools 5.7 / deployment target macOS 13: the lowest OS with MenuBarExtra,
// and what the repo's pinned Xcode (14.2) can express. Bump both when the
// toolchain moves — nothing here depends on newer APIs.
import PackageDescription

let package = Package(
    name: "InboxMinderBar",
    platforms: [.macOS(.v13)],
    dependencies: [
        // Auto-update for the distributed app. The core target stays
        // Sparkle-free so tests run headless.
        .package(url: "https://github.com/sparkle-project/Sparkle", from: "2.6.0")
    ],
    targets: [
        // All logic lives here, UI-free, so XCTest covers it headlessly.
        .target(name: "InboxMinderBarCore"),
        .executableTarget(
            name: "InboxMinderBar",
            dependencies: [
                "InboxMinderBarCore",
                .product(name: "Sparkle", package: "Sparkle"),
            ]
        ),
        .testTarget(
            name: "InboxMinderBarCoreTests",
            dependencies: ["InboxMinderBarCore"]
        ),
    ]
)
