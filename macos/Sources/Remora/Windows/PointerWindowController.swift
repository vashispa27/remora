import AppKit
import RemoraCore
import SwiftUI

/// A borderless panel that can become key without activating the Remora application,
/// so the previously frontmost application stays frontmost.
final class RemoraPointerPanel: NSPanel {
    override var canBecomeKey: Bool { false }
    override var canBecomeMain: Bool { false }
}

/// Owns the transparent overlay window that renders the Remora pointer.
///
/// `move` only changes the window's rendered origin. It never posts mouse events,
/// hides the system cursor, or otherwise touches the physical pointer.
@MainActor
final class PointerWindowController: AgentPointerAnimating {
    static let tipInset = CGPoint(x: 14, y: 14)

    private let panel: RemoraPointerPanel
    private let hostingView: NSHostingView<PointerView>
    private let viewModel = PointerViewModel()
    private var visibilityGeneration = 0

    var reduceMotion: Bool = false {
        didSet { hostingView.rootView = PointerView(model: viewModel, reduceMotion: reduceMotion) }
    }

    init() {
        let size = PanelMetrics.pointerWindowSize
        panel = RemoraPointerPanel(
            contentRect: CGRect(origin: .zero, size: size),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        hostingView = NSHostingView(rootView: PointerView(model: viewModel))

        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.level = .floating
        panel.ignoresMouseEvents = true
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false
        panel.isMovable = false
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        panel.contentView = hostingView
        hostingView.frame = CGRect(origin: .zero, size: size)
    }

    // MARK: - AgentPointerAnimating

    func appear(at point: CGPoint) async {
        visibilityGeneration += 1
        viewModel.state = .ready
        panel.setFrameOrigin(frameOrigin(forGlobalPoint: point))
        panel.alphaValue = 1
        panel.orderFrontRegardless()
    }

    func move(to point: CGPoint, duration: Duration) async {
        viewModel.state = .working
        let size = panel.frame.size
        let target = CGRect(origin: frameOrigin(forGlobalPoint: point), size: size)
        await animate(duration: max(duration.timeInterval, 0.05)) {
            self.panel.animator().setFrame(target, display: true)
        }
    }

    func showResult(_ result: PointerResult) async {
        switch result {
        case .success: viewModel.state = .success
        case .failure: viewModel.state = .error
        case .cancelled: viewModel.state = .cancelled
        }
        await animate(duration: 0.16) {
            self.panel.animator().alphaValue = 1
        }
    }

    func disappear() async {
        guard panel.isVisible else { return }
        visibilityGeneration += 1
        let token = visibilityGeneration
        await animate(duration: 0.12) {
            self.panel.animator().alphaValue = 0
        }
        guard visibilityGeneration == token else { return }
        panel.orderOut(nil)
        viewModel.state = .hidden
    }

    // MARK: - Layout

    func frameOrigin(forGlobalPoint point: CGPoint) -> CGPoint {
        let size = panel.frame.size
        return CGPoint(
            x: point.x - Self.tipInset.x,
            y: point.y - (size.height - Self.tipInset.y)
        )
    }

    func updateVisual(for phase: RemoraPhase) {
        switch phase {
        case .hidden: break
        case .ready: viewModel.state = .ready
        case .submitting: viewModel.state = .submitting
        case .working: viewModel.state = .working
        case .succeeded: viewModel.state = .success
        case .failed: viewModel.state = .error
        case .cancelled: viewModel.state = .cancelled
        }
    }

    func orderFront() {
        guard panel.isVisible else { return }
        panel.orderFrontRegardless()
    }

    /// Debug-only: show a specific pointer state at a location without a task run.
    func preview(state: PointerVisualState, at point: CGPoint) {
        viewModel.state = state
        panel.setFrameOrigin(frameOrigin(forGlobalPoint: point))
        panel.alphaValue = 1
        panel.orderFrontRegardless()
    }

    // MARK: - Helpers

    private func animate(duration: TimeInterval, _ body: @escaping () -> Void) async {
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            NSAnimationContext.runAnimationGroup { context in
                context.duration = duration
                context.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
                body()
            } completionHandler: {
                continuation.resume()
            }
        }
    }
}
