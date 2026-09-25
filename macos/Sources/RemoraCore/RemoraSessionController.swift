import CoreGraphics
import Foundation

/// UI-framework-agnostic driver for the whole prototype interaction.
///
/// It owns the observable model and the mock driver, turns driver events into model
/// transitions, and issues view-only commands to an `AgentPointerAnimating`. The AppKit
/// layer only supplies real windows, the frontmost-app context, and the visible frame.
@MainActor
public final class RemoraSessionController {
    public let model: RemoraUIModel
    public let driver: MockTaskUIDriver

    /// The pointer surface. Position/result commands are view-only.
    public weak var pointer: AgentPointerAnimating?

    /// Supplies the visible frame of the display the pointer was invoked on.
    public var visibleFrameProvider: (() -> CGRect)?

    /// When true, the pointer never travels; only labels and progress advance.
    public var reduceMotion: Bool = false

    /// Called after every state change so the AppKit layer can re-layout windows.
    public var onUIChange: (() -> Void)?

    public var successAutoDismissDelay: Duration = .milliseconds(2500)
    public var cancelledDisplayDelay: Duration = .seconds(1)

    private var isDismissing = false
    private var autoDismissTask: Task<Void, Never>?
    private var pointerTask: Task<Void, Never>?

    public init(model: RemoraUIModel? = nil, driver: MockTaskUIDriver? = nil) {
        let model = model ?? RemoraUIModel()
        let driver = driver ?? MockTaskUIDriver()
        self.model = model
        self.driver = driver
        driver.onEvent = { [weak self] event in
            self?.handle(event)
        }
    }

    // MARK: - User intents

    public func present(at point: CGPoint, context: FrontmostAppSummary?) {
        isDismissing = false
        cancelAutoDismiss()
        model.showReady(at: point, frontmostApp: context)

        pointerTask?.cancel()
        pointerTask = Task { [weak self] in
            await self?.pointer?.appear(at: point)
        }
        onUIChange?()
    }

    /// Fully dismisses the UI. Late driver events are ignored.
    public func dismiss() {
        isDismissing = true
        cancelAutoDismiss()
        pointerTask?.cancel()

        Task { [weak self] in
            await self?.driver.cancel()
        }
        model.hide()
        Task { [weak self] in
            await self?.pointer?.disappear()
        }
        onUIChange?()
    }

    public func submit() {
        guard !driver.isRunning else { return }
        guard let command = model.submitDraft() else { return }
        onUIChange?()

        Task { [weak self] in
            guard let self else { return }
            await self.driver.start(command: command)
        }
    }

    public func retry() {
        guard !driver.isRunning else { return }
        guard let command = model.beginRetry() else { return }
        onUIChange?()

        Task { [weak self] in
            guard let self else { return }
            await self.driver.start(command: command)
        }
    }

    public func stop() {
        Task { [weak self] in
            await self?.driver.cancel()
        }
    }

    /// Pauses automatic dismissal while the card is hovered or keyboard-focused.
    public func postponeAutoDismiss() {
        cancelAutoDismiss()
    }

    /// Resumes automatic dismissal for the current terminal state, if any.
    public func resumeAutoDismiss() {
        switch model.state.phase {
        case .succeeded:
            scheduleAutoDismiss(after: successAutoDismissDelay)
        case .cancelled:
            scheduleAutoDismiss(after: cancelledDisplayDelay)
        default:
            break
        }
    }

    // MARK: - Driver events

    private func handle(_ event: MockTaskEvent) {
        guard !isDismissing else { return }

        switch event {
        case .submitting(let command):
            model.applySubmitting(command: command)

        case .working(let command, let step, let index, let total, let progress):
            model.applyWorking(command: command, step: step, progress: progress, index: index, total: total)
            animateWorkingPointer()

        case .succeeded(let command, let summary):
            model.applySucceeded(command: command, summary: summary)
            showResult(.success)
            scheduleAutoDismiss(after: successAutoDismissDelay)

        case .failed(let command, let message):
            model.applyFailed(command: command, message: message)
            showResult(.failure)

        case .cancelled(let command):
            model.applyCancelled(command: command)
            showResult(.cancelled)
            scheduleAutoDismiss(after: cancelledDisplayDelay)
        }

        onUIChange?()
    }

    private func showResult(_ result: PointerResult) {
        pointerTask?.cancel()
        pointerTask = Task { [weak self] in
            await self?.pointer?.showResult(result)
        }
    }

    private func animateWorkingPointer() {
        guard !reduceMotion, let pointer, let frame = visibleFrameProvider?() else { return }
        let start = model.invocationPoint ?? CGPoint(x: frame.midX, y: frame.midY)
        let path = RemoraSessionController.mockPath(from: start, in: frame)

        pointerTask?.cancel()
        pointerTask = Task {
            for point in path {
                if Task.isCancelled { return }
                let distance = hypot(point.x - start.x, point.y - start.y)
                let milliseconds = Int(min(max(distance * 1.2, 350), 700))
                await pointer.move(to: point, duration: .milliseconds(milliseconds))
            }
        }
    }

    /// Deterministic three-point path used to suggest intention. Never derived from
    /// another application's controls.
    public static func mockPath(from start: CGPoint, in visibleFrame: CGRect) -> [CGPoint] {
        let offsets: [CGPoint] = [
            CGPoint(x: 140, y: 90),
            CGPoint(x: 280, y: -30),
            CGPoint(x: 80, y: 150)
        ]
        return offsets.map { offset in
            DisplayGeometry.clampedPoint(
                CGPoint(x: start.x + offset.x, y: start.y + offset.y),
                in: visibleFrame
            )
        }
    }

    // MARK: - Auto dismissal

    private func scheduleAutoDismiss(after delay: Duration) {
        cancelAutoDismiss()
        autoDismissTask = Task { [weak self] in
            guard let self else { return }
            try? await Task.sleep(for: delay)
            if Task.isCancelled { return }
            self.autoDismissIfTerminal()
        }
    }

    private func autoDismissIfTerminal() {
        switch model.state.phase {
        case .succeeded, .cancelled:
            dismiss()
        default:
            break
        }
    }

    private func cancelAutoDismiss() {
        autoDismissTask?.cancel()
        autoDismissTask = nil
    }
}
