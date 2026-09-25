import Foundation

/// The UI seam between the front end and whatever drives post-submit state.
///
/// The prototype uses `MockTaskUIDriver`. A future backend must be able to replace it
/// without changing any view. This protocol deliberately contains no network, model,
/// retrieval, or automation concepts.
@MainActor
public protocol TaskUIDriving: AnyObject {
    func start(command: String) async
    func cancel() async
}

/// Deterministic events emitted by the mock driver. Each event carries the command so
/// the coordinator can update the model without maintaining parallel bookkeeping.
public enum MockTaskEvent: Equatable, Sendable {
    case submitting(command: String)
    case working(command: String, step: String, index: Int, total: Int, progress: Double)
    case succeeded(command: String, summary: String)
    case failed(command: String, message: String)
    case cancelled(command: String)

    public var command: String {
        switch self {
        case .submitting(let command): return command
        case .working(let command, _, _, _, _): return command
        case .succeeded(let command, _): return command
        case .failed(let command, _): return command
        case .cancelled(let command): return command
        }
    }
}
