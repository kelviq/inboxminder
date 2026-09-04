import AppKit
import SwiftUI

/// CleanShot-style transient balloon anchored under this app's menu bar
/// item: the answer to "I opened the app and nothing happened" on a
/// Dock-less menu-bar app. Shows for a few seconds, click to dismiss.
@MainActor
enum TrayBalloon {
    private static var panel: NSPanel?
    private static var closeWork: DispatchWorkItem?

    static func show(_ text: String, seconds: TimeInterval = 5) {
        dismiss()

        let view = BalloonView(text: text) { dismiss() }
        let hosting = NSHostingView(rootView: view)
        hosting.setFrameSize(hosting.fittingSize)

        let panel = NSPanel(
            contentRect: NSRect(origin: .zero, size: hosting.fittingSize),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered, defer: false)
        panel.isFloatingPanel = true
        panel.level = .statusBar
        panel.backgroundColor = .clear
        panel.isOpaque = false
        panel.hasShadow = false  // the SwiftUI view draws its own
        panel.collectionBehavior = [.canJoinAllSpaces, .transient]
        panel.contentView = hosting

        let size = hosting.fittingSize
        panel.setFrameOrigin(anchorOrigin(for: size))
        panel.orderFrontRegardless()
        Self.panel = panel

        let work = DispatchWorkItem { dismiss() }
        closeWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + seconds, execute: work)
    }

    static func dismiss() {
        closeWork?.cancel()
        closeWork = nil
        panel?.close()
        panel = nil
    }

    /// Centered under this app's status item when it can be found;
    /// otherwise near the top-right of the main screen, which is where
    /// a fresh menu bar item lands anyway.
    private static func anchorOrigin(for size: NSSize) -> NSPoint {
        let statusFrame = NSApp.windows.first {
            $0.className.contains("StatusBarWindow")
        }?.frame
        if let f = statusFrame {
            return NSPoint(
                x: f.midX - size.width / 2,
                y: f.minY - size.height - 2)
        }
        let screen = NSScreen.main?.visibleFrame ?? .zero
        return NSPoint(
            x: screen.maxX - size.width - 80,
            y: screen.maxY - size.height - 8)
    }
}

private struct BalloonView: View {
    let text: String
    let onTap: () -> Void

    var body: some View {
        VStack(spacing: 0) {
            Triangle()
                .fill(Color.black.opacity(0.88))
                .frame(width: 16, height: 8)
            Text(text)
                .font(.callout.weight(.medium))
                .foregroundColor(.white)
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .background(
                    Capsule().fill(Color.black.opacity(0.88))
                )
        }
        .padding(.horizontal, 10)
        .padding(.bottom, 12)
        .shadow(color: .black.opacity(0.3), radius: 8, y: 3)
        .onTapGesture(perform: onTap)
    }
}

private struct Triangle: Shape {
    func path(in rect: CGRect) -> Path {
        var p = Path()
        p.move(to: CGPoint(x: rect.midX, y: rect.minY))
        p.addLine(to: CGPoint(x: rect.maxX, y: rect.maxY))
        p.addLine(to: CGPoint(x: rect.minX, y: rect.maxY))
        p.closeSubpath()
        return p
    }
}

/// Bridges AppKit's reopen event (Finder double-click on an already-
/// running app) to SwiftUI, where openWindow lives.
@MainActor
enum ReopenBridge {
    static var handler: (() -> Void)?
}
