import Foundation

/// Snapshot of the accessibility display settings the UI must respect.
public struct AccessibilityDisplaySettings: Equatable, Sendable {
    public var reduceMotion: Bool
    public var reduceTransparency: Bool

    public init(reduceMotion: Bool = false, reduceTransparency: Bool = false) {
        self.reduceMotion = reduceMotion
        self.reduceTransparency = reduceTransparency
    }

    public static let `default` = AccessibilityDisplaySettings()
}
