import AppKit

/// Menu items for the debug previews required by the pointer and mock-task subtasks.
enum DebugMenuKind: Int, CaseIterable {
    case previewSeparator
    case previewReady
    case previewSubmitting
    case previewWorking
    case previewSuccess
    case previewError
    case previewCancelled
    case pathSeparator
    case threePointPath
    case reduceMotionPreview
    case edgeSeparator
    case edgeLeft
    case edgeRight
    case edgeTop
    case edgeBottom
    case outcomeSeparator
    case forceFailure
    case forceCancellation
    case cancelCurrent

    var isSeparator: Bool {
        switch self {
        case .previewSeparator, .pathSeparator, .edgeSeparator, .outcomeSeparator:
            return true
        default:
            return false
        }
    }

    var title: String {
        switch self {
        case .previewSeparator, .pathSeparator, .edgeSeparator, .outcomeSeparator:
            return ""
        case .previewReady: return "Preview Pointer: Ready"
        case .previewSubmitting: return "Preview Pointer: Submitting"
        case .previewWorking: return "Preview Pointer: Working"
        case .previewSuccess: return "Preview Pointer: Success"
        case .previewError: return "Preview Pointer: Error"
        case .previewCancelled: return "Preview Pointer: Cancelled"
        case .threePointPath: return "Preview Three-Point Path"
        case .reduceMotionPreview: return "Preview With Reduce Motion"
        case .edgeLeft: return "Preview Near Left Edge"
        case .edgeRight: return "Preview Near Right Edge"
        case .edgeTop: return "Preview Near Top Edge"
        case .edgeBottom: return "Preview Near Bottom Edge"
        case .forceFailure: return "Force Next Run: Failure"
        case .forceCancellation: return "Force Next Run: Cancellation"
        case .cancelCurrent: return "Cancel Current Run"
        }
    }
}

@MainActor
final class MenuBarController: NSObject {
    private let statusItem: NSStatusItem
    private weak var coordinator: RemoraCoordinator?

    init(coordinator: RemoraCoordinator) {
        self.coordinator = coordinator
        self.statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        super.init()
        configure()
    }

    private func configure() {
        if let button = statusItem.button {
            let image = NSImage(systemSymbolName: "cursorarrow.motionlines", accessibilityDescription: "Remora")
            image?.isTemplate = true
            button.image = image
            button.toolTip = "Remora"
        }

        let menu = NSMenu()

        let showItem = NSMenuItem(title: "Show Remora", action: #selector(RemoraCoordinator.showFromMenu), keyEquivalent: "")
        showItem.target = coordinator
        menu.addItem(showItem)

        let hideItem = NSMenuItem(title: "Hide Remora", action: #selector(RemoraCoordinator.dismissFromMenu), keyEquivalent: "")
        hideItem.target = coordinator
        menu.addItem(hideItem)

        menu.addItem(.separator())

        let debugItem = NSMenuItem(title: "Debug", action: nil, keyEquivalent: "")
        debugItem.submenu = makeDebugMenu()
        menu.addItem(debugItem)

        menu.addItem(.separator())

        let quitItem = NSMenuItem(title: "Quit Remora", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        quitItem.target = NSApp
        menu.addItem(quitItem)

        statusItem.menu = menu
    }

    private func makeDebugMenu() -> NSMenu {
        let menu = NSMenu()
        for kind in DebugMenuKind.allCases {
            if kind.isSeparator {
                menu.addItem(.separator())
                continue
            }
            let item = NSMenuItem(
                title: kind.title,
                action: #selector(RemoraCoordinator.handleDebugMenuItem(_:)),
                keyEquivalent: ""
            )
            item.target = coordinator
            item.tag = kind.rawValue
            menu.addItem(item)
        }
        return menu
    }
}
