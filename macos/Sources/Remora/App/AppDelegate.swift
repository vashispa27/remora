import AppKit

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var coordinator: RemoraCoordinator?

    func applicationDidFinishLaunching(_ notification: Notification) {
        // Menu-bar only. No Dock icon, no default window, no onboarding.
        NSApp.setActivationPolicy(.accessory)

        let coordinator = RemoraCoordinator()
        self.coordinator = coordinator
        coordinator.start()
    }

    func applicationWillTerminate(_ notification: Notification) {
        coordinator?.shutdown()
    }
}
