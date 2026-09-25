import RemoraCore
import SwiftUI

@MainActor
final class PanelFocusModel: ObservableObject {
    @Published var isFocused = false
    @Published var isHovered = false
}

@MainActor
final class PanelAppearanceModel: ObservableObject {
    @Published var reduceTransparency = false
}

/// Swaps between the command panel and the activity card based on the shared state.
struct PanelRootView: View {
    @ObservedObject var model: RemoraUIModel
    @ObservedObject var focus: PanelFocusModel
    @ObservedObject var appearance: PanelAppearanceModel
    let onSubmit: () -> Void
    let onDismiss: () -> Void
    let onStop: () -> Void
    let onRetry: () -> Void
    let onHover: (Bool) -> Void

    var body: some View {
        content
            .onHover { hovering in
                focus.isHovered = hovering
                onHover(hovering)
            }
    }

    @ViewBuilder
    private var content: some View {
        switch model.state.phase {
        case .hidden:
            EmptyView()
        case .ready:
            CommandPanelView(
                model: model,
                context: model.frontmostApp,
                reduceTransparency: appearance.reduceTransparency,
                isFocused: $focus.isFocused,
                onSubmit: onSubmit,
                onDismiss: onDismiss
            )
        default:
            ActivityCardView(
                model: model,
                reduceTransparency: appearance.reduceTransparency,
                onStop: onStop,
                onRetry: onRetry,
                onDismiss: onDismiss
            )
        }
    }
}
