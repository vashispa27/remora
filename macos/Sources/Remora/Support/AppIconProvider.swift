import AppKit
import RemoraCore

@MainActor
enum AppIconProvider {
    /// Resolves the icon for a captured frontmost app. Cosmetic only.
    static func icon(for context: FrontmostAppSummary) -> NSImage? {
        guard let bundleIdentifier = context.bundleIdentifier,
              let application = NSWorkspace.shared.runningApplications.first(where: {
                  $0.bundleIdentifier == bundleIdentifier
              })
        else { return nil }
        return application.icon
    }
}
