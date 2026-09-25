import AppKit
import Carbon.HIToolbox
import RemoraCore
import os

private let coordinatorLogger = Logger(subsystem: "com.remora.prototype", category: "coordinator")

/// Wires the session controller, the shortcut, the menu bar, and the two overlay windows.
@MainActor
final class RemoraCoordinator: NSObject {
    private let session: RemoraSessionController
    private let pointerController: PointerWindowController
    private let panelController: PanelWindowController
    private let accessibilityObserver = SystemAccessibilityObserver()

    private var shortcut: GlobalShortcutController?
    private var menuBar: MenuBarController?
    private var pathTask: Task<Void, Never>?

    override init() {
        let session = RemoraSessionController()
        self.session = session
        self.pointerController = PointerWindowController()
        self.panelController = PanelWindowController(session: session)
        super.init()
    }

    func start() {
        session.pointer = pointerController
        session.visibleFrameProvider = { [weak self] in
            guard let self else { return .zero }
            return self.visibleFrame(containing: NSEvent.mouseLocation)
        }
        session.onUIChange = { [weak self] in
            self?.syncUI()
        }

        applyAccessibility(accessibilityObserver.settings)
        accessibilityObserver.onChange = { [weak self] settings in
            self?.applyAccessibility(settings)
        }

        let shortcut = GlobalShortcutController()
        let toggleShortcut = ShortcutDefinition(
            id: 1,
            keyCode: UInt32(kVK_Space),
            modifiers: UInt32(cmdKey | shiftKey)
        ) { [weak self] in
            self?.toggle()
        }
        let summonShortcut = ShortcutDefinition(
            id: 2,
            keyCode: UInt32(kVK_ANSI_R),
            modifiers: UInt32(controlKey | optionKey)
        ) { [weak self] in
            self?.summonAtPointer()
        }
        shortcut.register([toggleShortcut, summonShortcut])
        self.shortcut = shortcut

        menuBar = MenuBarController(coordinator: self)
    }

    func shutdown() {
        pathTask?.cancel()
        pathTask = nil
        shortcut?.unregister()
        shortcut = nil
        session.dismiss()
        accessibilityObserver.stop()
    }

    // MARK: - Invocation

    func toggle() {
        switch session.model.state.phase {
        case .hidden:
            show()
        case .submitting, .working:
            bringForward()
        default:
            session.dismiss()
        }
    }

    func show() {
        let point = NSEvent.mouseLocation
        let context = currentFrontmostContext()
        coordinatorLogger.notice(
            "Show Remora at x=\(Double(point.x), privacy: .public) y=\(Double(point.y), privacy: .public) frontmost=\(context?.name ?? "none", privacy: .public)"
        )
        session.present(at: point, context: context)
    }

    private func bringForward() {
        panelController.orderFront()
        pointerController.orderFront()
    }

    /// Opens Remora at the current pointer location, or brings the existing UI forward
    /// without starting a new run.
    private func summonAtPointer() {
        coordinatorLogger.notice("Summon shortcut invoked")
        if session.model.state.isVisible {
            bringForward()
        } else {
            show()
        }
    }

    @objc func showFromMenu() {
        show()
    }

    @objc func dismissFromMenu() {
        session.dismiss()
    }

    // MARK: - UI sync

    private func syncUI() {
        let state = session.model.state
        pointerController.updateVisual(for: state.phase)

        guard state.isVisible else {
            panelController.hide()
            return
        }

        panelController.show()
        panelController.setFocused(state.phase == .ready)

        if let point = session.model.invocationPoint {
            panelController.position(
                pointerTip: point,
                visibleFrame: visibleFrame(containing: point)
            )
        }
    }

    private func applyAccessibility(_ settings: AccessibilityDisplaySettings) {
        session.reduceMotion = settings.reduceMotion
        pointerController.reduceMotion = settings.reduceMotion
        panelController.appearanceModel.reduceTransparency = settings.reduceTransparency
    }

    // MARK: - Geometry

    private func visibleFrame(containing point: CGPoint) -> CGRect {
        let screen = NSScreen.screens.first { $0.frame.contains(point) } ?? NSScreen.main
        return screen?.visibleFrame ?? CGRect(x: 0, y: 0, width: 1440, height: 900)
    }

    private func currentFrontmostContext() -> FrontmostAppSummary? {
        guard let application = NSWorkspace.shared.frontmostApplication else { return nil }
        return FrontmostAppSummary(
            name: application.localizedName ?? "Unknown",
            bundleIdentifier: application.bundleIdentifier
        )
    }

    // MARK: - Debug menu

    @objc func handleDebugMenuItem(_ sender: NSMenuItem) {
        guard let kind = DebugMenuKind(rawValue: sender.tag) else { return }
        let point = NSEvent.mouseLocation

        switch kind {
        case .previewReady: pointerController.preview(state: .ready, at: point)
        case .previewSubmitting: pointerController.preview(state: .submitting, at: point)
        case .previewWorking: pointerController.preview(state: .working, at: point)
        case .previewSuccess: pointerController.preview(state: .success, at: point)
        case .previewError: pointerController.preview(state: .error, at: point)
        case .previewCancelled: pointerController.preview(state: .cancelled, at: point)
        case .threePointPath: runMockPath()
        case .reduceMotionPreview: previewWithReduceMotion()
        case .edgeLeft: previewEdge(.left)
        case .edgeRight: previewEdge(.right)
        case .edgeTop: previewEdge(.top)
        case .edgeBottom: previewEdge(.bottom)
        case .forceFailure: session.driver.debugForceFailure = true
        case .forceCancellation: session.driver.debugForceCancellation = true
        case .cancelCurrent: session.stop()
        case .previewSeparator, .pathSeparator, .edgeSeparator, .outcomeSeparator: break
        }
    }

    private func runMockPath() {
        pathTask?.cancel()
        let point = NSEvent.mouseLocation
        let frame = visibleFrame(containing: point)
        let path = RemoraSessionController.mockPath(from: point, in: frame)
        pointerController.preview(state: .working, at: point)

        pathTask = Task { [weak self] in
            guard let self else { return }
            for target in path {
                if Task.isCancelled { return }
                await self.pointerController.move(to: target, duration: .milliseconds(450))
            }
        }
    }

    private func previewWithReduceMotion() {
        // Reduce Motion replaces travel with a short opacity transition.
        pointerController.reduceMotion = true
        pointerController.preview(state: .ready, at: NSEvent.mouseLocation)
    }

    private enum Edge {
        case left, right, top, bottom
    }

    private func previewEdge(_ edge: Edge) {
        let frame = visibleFrame(containing: NSEvent.mouseLocation)
        let margin: CGFloat = 40
        let point: CGPoint
        switch edge {
        case .left:
            point = CGPoint(x: frame.minX + margin, y: frame.midY)
        case .right:
            point = CGPoint(x: frame.maxX - margin, y: frame.midY)
        case .top:
            point = CGPoint(x: frame.midX, y: frame.maxY - margin)
        case .bottom:
            point = CGPoint(x: frame.midX, y: frame.minY + margin)
        }
        pointerController.preview(state: .ready, at: point)
    }
}
