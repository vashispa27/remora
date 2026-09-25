import Combine
import CoreGraphics
import Foundation

/// The single observable UI model shared by every Remora surface.
///
/// Views read `state` and `draft`; they never advance post-submit states themselves.
/// `MockTaskUIDriver` (or a future backend that replaces it) is the only component
/// allowed to move submitting -> working -> terminal.
@MainActor
public final class RemoraUIModel: ObservableObject {
    @Published public private(set) var state: RemoraUIState = .hidden
    @Published public var draft: String = "" {
        didSet { clampDraft() }
    }
    @Published public private(set) var invocationPoint: CGPoint?
    @Published public var frontmostApp: FrontmostAppSummary?
    @Published public private(set) var workingStepIndex = 0
    @Published public private(set) var workingStepTotal = 0

    public let maxCommandLength = 2000
    public let countWarningThreshold = 1800

    public init() {}

    public var trimmedDraft: String {
        draft.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    public var canSubmit: Bool {
        !trimmedDraft.isEmpty
    }

    public var shouldShowCharacterCount: Bool {
        draft.count >= countWarningThreshold
    }

    /// Editing is locked as soon as a valid submission leaves the ready phase.
    public var isEditingLocked: Bool {
        state.phase != .ready
    }

    public var visibleCommand: String? {
        state.command
    }

    private func clampDraft() {
        if draft.count > maxCommandLength {
            draft = String(draft.prefix(maxCommandLength))
        }
    }

    /// Applies a validated transition. Returns `false` when the transition is invalid
    /// so callers and tests can observe rejected transitions without crashing.
    @discardableResult
    public func apply(_ newState: RemoraUIState) -> Bool {
        do {
            state = try RemoraStateMachine.validate(from: state, to: newState)
            return true
        } catch {
            return false
        }
    }

    public func showReady(at point: CGPoint, frontmostApp: FrontmostAppSummary?) {
        self.invocationPoint = point
        self.frontmostApp = frontmostApp
        draft = ""
        _ = apply(.ready)
    }

    public func hide() {
        draft = ""
        invocationPoint = nil
        _ = apply(.hidden)
    }

    /// Validates and trims the current draft, then moves ready -> submitting.
    /// Returns the command that should be handled, or `nil` when submission is rejected.
    public func submitDraft() -> String? {
        guard state.phase == .ready, canSubmit else { return nil }
        let command = trimmedDraft
        guard apply(.submitting(command: command)) else { return nil }
        return command
    }

    /// Retry after failure, reusing the failed command. Moves failed -> submitting.
    public func beginRetry() -> String? {
        guard case .failed(let command, _) = state else { return nil }
        guard apply(.submitting(command: command)) else { return nil }
        return command
    }

    // MARK: - Driver-applied transitions

    public func applySubmitting(command: String) {
        _ = apply(.submitting(command: command))
    }

    public func applyWorking(command: String, step: String, progress: Double, index: Int = 0, total: Int = 0) {
        workingStepIndex = index
        workingStepTotal = total
        let clamped = min(max(progress, 0), 1)
        _ = apply(.working(command: command, step: step, progress: clamped))
    }

    public func applySucceeded(command: String, summary: String) {
        _ = apply(.succeeded(command: command, summary: summary))
    }

    public func applyFailed(command: String, message: String) {
        _ = apply(.failed(command: command, message: message))
    }

    public func applyCancelled(command: String) {
        _ = apply(.cancelled(command: command))
    }
}
