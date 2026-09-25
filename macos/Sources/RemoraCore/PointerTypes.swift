import CoreGraphics

public struct AgentPointerPosition: Equatable, Sendable {
    public var globalPoint: CGPoint

    public init(globalPoint: CGPoint) {
        self.globalPoint = globalPoint
    }
}

public enum PointerResult: Equatable, Sendable {
    case success
    case failure
    case cancelled
}

/// View-only positioning of the Remora pointer.
///
/// Implementations must never call Core Graphics event-posting APIs, hide the system
/// cursor, or move the physical pointer. `move` changes rendered position only.
@MainActor
public protocol AgentPointerAnimating: AnyObject {
    func appear(at point: CGPoint) async
    func move(to point: CGPoint, duration: Duration) async
    func showResult(_ result: PointerResult) async
    func disappear() async
}
