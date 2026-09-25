import AppKit
import RemoraCore
import SwiftUI

/// Borderless panel that can become key to receive keyboard input.
final class RemoraPanel: NSPanel {
    var onEscape: (() -> Void)?

    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }

    override func cancelOperation(_ sender: Any?) {
        onEscape?()
    }
}

/// Owns the command panel / activity card window.
@MainActor
final class PanelWindowController {
    let focusModel = PanelFocusModel()
    let appearanceModel = PanelAppearanceModel()

    private let panel: RemoraPanel
    private let hostingView: NSHostingView<PanelRootView>
    private var visibilityGeneration = 0

    init(session: RemoraSessionController) {
        panel = RemoraPanel(
            contentRect: CGRect(x: 0, y: 0, width: PanelMetrics.targetWidth, height: 160),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )

        let focusModel = self.focusModel
        let appearanceModel = self.appearanceModel
        hostingView = NSHostingView(
            rootView: PanelRootView(
                model: session.model,
                focus: focusModel,
                appearance: appearanceModel,
                onSubmit: { [weak session] in session?.submit() },
                onDismiss: { [weak session] in session?.dismiss() },
                onStop: { [weak session] in session?.stop() },
                onRetry: { [weak session] in session?.retry() },
                onHover: { [weak session] hovering in
                    if hovering {
                        session?.postponeAutoDismiss()
                    } else {
                        session?.resumeAutoDismiss()
                    }
                }
            )
        )

        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.level = .floating
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false
        panel.isMovable = false
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]
        panel.contentView = hostingView
        panel.onEscape = { [weak session] in session?.dismiss() }
    }

    // MARK: - Visibility

    func show() {
        visibilityGeneration += 1
        refreshLayout()
        if !panel.isVisible {
            panel.alphaValue = 0
            panel.makeKeyAndOrderFront(nil)
        }
        Task { await self.fade(to: 1, duration: 0.16) }
    }

    func hide() {
        guard panel.isVisible else { return }
        visibilityGeneration += 1
        let token = visibilityGeneration
        Task {
            await self.fade(to: 0, duration: 0.12)
            guard self.visibilityGeneration == token else { return }
            self.panel.orderOut(nil)
            self.focusModel.isFocused = false
        }
    }

    func orderFront() {
        guard panel.isVisible else { return }
        panel.orderFrontRegardless()
        panel.makeKey()
    }

    func setFocused(_ focused: Bool) {
        focusModel.isFocused = focused
        if focused, panel.isVisible {
            panel.makeKey()
        }
    }

    // MARK: - Layout

    /// Resizes the window to the intrinsic size of the current content.
    func refreshLayout() {
        hostingView.layoutSubtreeIfNeeded()
        var size = hostingView.fittingSize
        if size.width < 1 { size.width = 392 }
        if size.height < 1 { size.height = 84 }
        size.width = min(max(size.width, PanelMetrics.minWidth), PanelMetrics.maxWidth)
        panel.setContentSize(size)
        hostingView.frame = CGRect(origin: .zero, size: size)
    }

    func position(pointerTip: CGPoint, visibleFrame: CGRect) {
        let placement = DisplayGeometry.panelPlacement(
            pointerTip: pointerTip,
            panelSize: panel.frame.size,
            visibleFrame: visibleFrame
        )
        panel.setFrame(placement.frame, display: true)
    }

    // MARK: - Helpers

    private func fade(to alpha: CGFloat, duration: TimeInterval) async {
        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            NSAnimationContext.runAnimationGroup { context in
                context.duration = duration
                self.panel.animator().alphaValue = alpha
            } completionHandler: {
                continuation.resume()
            }
        }
    }
}
