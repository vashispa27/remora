import SwiftUI

/// Pointer appearance states. These are view-only; they never imply real input.
enum PointerVisualState: Equatable {
    case hidden
    case ready
    case submitting
    case working
    case success
    case error
    case cancelled
}

@MainActor
final class PointerViewModel: ObservableObject {
    @Published var state: PointerVisualState = .hidden
}

/// The Remora agent pointer: a familiar arrow silhouette in the accent color with a
/// status dot and result badge. It is an overlay view only.
struct PointerView: View {
    @ObservedObject var model: PointerViewModel
    var reduceMotion: Bool = false

    private let tipInset: CGFloat = 14
    private let pointerWidth: CGFloat = 20
    private let pointerHeight: CGFloat = 26

    var body: some View {
        ZStack(alignment: .topLeading) {
            arrow
            statusDot
            badge
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .allowsHitTesting(false)
        .animation(reduceMotion ? nil : .easeInOut(duration: 0.16), value: model.state)
    }

    private var arrow: some View {
        ArrowShape()
            .fill(Color.remoraAccent)
            .overlay(
                ArrowShape()
                    .stroke(Color.black.opacity(0.55), lineWidth: 1)
            )
            .frame(width: pointerWidth, height: pointerHeight)
            .offset(x: tipInset, y: tipInset)
            .shadow(color: .black.opacity(0.25), radius: 2, x: 0, y: 1)
    }

    private var statusDot: some View {
        Circle()
            .fill(statusColor)
            .frame(width: 9, height: 9)
            .overlay(Circle().stroke(Color.white.opacity(0.8), lineWidth: 1))
            .offset(x: tipInset + pointerWidth - 2, y: tipInset + pointerHeight - 4)
            .opacity(model.state == .hidden ? 0 : 1)
    }

    @ViewBuilder
    private var badge: some View {
        switch model.state {
        case .success:
            badgeImage(systemName: "checkmark.circle.fill", color: .green)
        case .error:
            badgeImage(systemName: "exclamationmark.circle.fill", color: .red)
        case .cancelled:
            badgeImage(systemName: "slash.circle.fill", color: .gray)
        default:
            EmptyView()
        }
    }

    private func badgeImage(systemName: String, color: Color) -> some View {
        Image(systemName: systemName)
            .font(.system(size: 15, weight: .bold))
            .foregroundStyle(color)
            .background(Circle().fill(Color.white.opacity(0.9)))
            .offset(x: tipInset + pointerWidth - 4, y: tipInset - 12)
    }

    private var statusColor: Color {
        switch model.state {
        case .ready: return Color.remoraAccent
        case .submitting: return Color.remoraAccent
        case .working: return Color.remoraAccent
        case .success: return .green
        case .error: return .red
        case .cancelled: return .gray
        case .hidden: return .clear
        }
    }
}

/// Arrow/caret silhouette with the logical tip at the top-left corner of its bounds.
struct ArrowShape: Shape {
    func path(in rect: CGRect) -> Path {
        let width = rect.width
        let height = rect.height
        func point(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
            CGPoint(x: rect.minX + x * width, y: rect.minY + y * height)
        }

        var path = Path()
        path.move(to: point(0, 0))
        path.addLine(to: point(0.02, 0.94))
        path.addLine(to: point(0.30, 0.68))
        path.addLine(to: point(0.52, 1.0))
        path.addLine(to: point(0.70, 0.92))
        path.addLine(to: point(0.48, 0.62))
        path.addLine(to: point(0.84, 0.60))
        path.closeSubpath()
        return path
    }
}
