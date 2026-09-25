import Foundation

/// Cosmetic context for the command panel's context chip.
///
/// This deliberately carries only an app name and bundle identifier. The prototype
/// never inspects the application's windows, controls, or content.
public struct FrontmostAppSummary: Equatable, Sendable {
    public var name: String
    public var bundleIdentifier: String?

    public init(name: String, bundleIdentifier: String? = nil) {
        self.name = name
        self.bundleIdentifier = bundleIdentifier
    }
}
