import AppKit
import RemoraCore

/// Observes the accessibility display options the UI must respect.
@MainActor
final class SystemAccessibilityObserver {
    private(set) var settings: AccessibilityDisplaySettings = .default
    var onChange: ((AccessibilityDisplaySettings) -> Void)?

    private var observer: NSObjectProtocol?

    init() {
        refresh()
        observer = NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.accessibilityDisplayOptionsDidChangeNotification,
            object: nil,
            queue: .main
        ) { [weak self] _ in
            MainActor.assumeIsolated {
                self?.refresh()
            }
        }
    }

    func stop() {
        if let observer {
            NSWorkspace.shared.notificationCenter.removeObserver(observer)
            self.observer = nil
        }
    }

    private func refresh() {
        settings = AccessibilityDisplaySettings(
            reduceMotion: NSWorkspace.shared.accessibilityDisplayShouldReduceMotion,
            reduceTransparency: NSWorkspace.shared.accessibilityDisplayShouldReduceTransparency
        )
        onChange?(settings)
    }
}
