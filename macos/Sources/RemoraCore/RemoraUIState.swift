import Foundation

/// The coarse phase of the Remora UI. Two states with the same command may share a phase.
public enum RemoraPhase: String, CaseIterable, Equatable, Sendable {
    case hidden
    case ready
    case submitting
    case working
    case succeeded
    case failed
    case cancelled
}

/// The single observable state of the Remora prototype UI.
///
/// This state is intentionally UI-only. Nothing in this type describes real automation,
/// network activity, or application control.
public enum RemoraUIState: Equatable, Sendable {
    case hidden
    case ready
    case submitting(command: String)
    case working(command: String, step: String, progress: Double)
    case succeeded(command: String, summary: String)
    case failed(command: String, message: String)
    case cancelled(command: String)

    public var phase: RemoraPhase {
        switch self {
        case .hidden: return .hidden
        case .ready: return .ready
        case .submitting: return .submitting
        case .working: return .working
        case .succeeded: return .succeeded
        case .failed: return .failed
        case .cancelled: return .cancelled
        }
    }

    public var isVisible: Bool {
        self != .hidden
    }

    /// The command associated with the state, if any. `hidden` and `ready` carry no command.
    public var command: String? {
        switch self {
        case .hidden, .ready:
            return nil
        case .submitting(let command), .cancelled(let command):
            return command
        case .working(let command, _, _):
            return command
        case .succeeded(let command, _):
            return command
        case .failed(let command, _):
            return command
        }
    }
}

public enum RemoraTransitionError: Error, Equatable {
    case invalidTransition(from: RemoraPhase, to: RemoraPhase)
    case commandMismatch(from: String?, to: String?)
}

/// Pure transition rules for the Remora UI state machine.
///
/// The model and views never mutate `state` directly; every change is validated here.
public enum RemoraStateMachine {
    public static func canTransition(from: RemoraPhase, to: RemoraPhase) -> Bool {
        if from == to { return false }

        // Dismissal is always allowed from a visible phase.
        if to == .hidden { return from != .hidden }

        switch (from, to) {
        case (.hidden, .ready):
            return true
        case (.ready, .submitting):
            return true
        case (.submitting, .working), (.submitting, .failed), (.submitting, .cancelled):
            return true
        case (.working, .succeeded), (.working, .failed), (.working, .cancelled):
            return true
        case (.succeeded, .ready):
            return true
        case (.failed, .submitting), (.failed, .ready):
            return true
        case (.cancelled, .ready):
            return true
        default:
            return false
        }
    }

    @discardableResult
    public static func validate(from: RemoraUIState, to: RemoraUIState) throws -> RemoraUIState {
        guard canTransition(from: from.phase, to: to.phase) else {
            throw RemoraTransitionError.invalidTransition(from: from.phase, to: to.phase)
        }

        // A transition that carries a command must not silently change it, unless the
        // source had no command to begin with (ready -> submitting).
        if let targetCommand = to.command, let sourceCommand = from.command,
           targetCommand != sourceCommand {
            throw RemoraTransitionError.commandMismatch(from: sourceCommand, to: targetCommand)
        }

        return to
    }
}
