import AppKit
import RemoraCore
import SwiftUI

/// Native material background for the command panel and activity card.
struct PanelBackground: NSViewRepresentable {
    var reduceTransparency: Bool

    func makeNSView(context: Context) -> NSVisualEffectView {
        let view = NSVisualEffectView()
        view.wantsLayer = true
        view.layer?.cornerRadius = PanelMetrics.cornerRadius
        view.layer?.masksToBounds = true
        view.layer?.borderWidth = 1
        view.layer?.borderColor = NSColor.separatorColor.withAlphaComponent(0.6).cgColor
        apply(to: view)
        return view
    }

    func updateNSView(_ nsView: NSVisualEffectView, context: Context) {
        apply(to: nsView)
    }

    private func apply(to view: NSVisualEffectView) {
        if reduceTransparency {
            view.material = .windowBackground
            view.blendingMode = .withinWindow
            view.state = .active
        } else {
            view.material = .hudWindow
            view.blendingMode = .behindWindow
            view.state = .active
        }
    }
}
