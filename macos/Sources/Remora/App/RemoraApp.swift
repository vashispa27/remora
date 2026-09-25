import AppKit
import SwiftUI

@main
struct RemoraApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    var body: some Scene {
        // No document or main window. The entire UI is driven by the menu bar,
        // the pointer overlay, and the command panel.
        Settings {
            EmptyView()
        }
    }
}
