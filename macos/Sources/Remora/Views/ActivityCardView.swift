import RemoraCore
import SwiftUI

/// The compact activity card shown from `submitting` through terminal states.
struct ActivityCardView: View {
    @ObservedObject var model: RemoraUIModel
    let reduceTransparency: Bool
    let onStop: () -> Void
    let onRetry: () -> Void
    let onDismiss: () -> Void

    @State private var showsCommand = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            header
            detail
            commandDisclosure
        }
        .padding(14)
        .frame(width: 392)
        .background(PanelBackground(reduceTransparency: reduceTransparency))
    }

    private var header: some View {
        HStack(spacing: 8) {
            statusIndicator
            Text(title)
                .font(.system(size: 13, weight: .semibold))
            Spacer()
            trailingControl
        }
    }

    private var statusIndicator: some View {
        Group {
            switch model.state.phase {
            case .submitting, .working:
                ProgressView()
                    .controlSize(.small)
            case .succeeded:
                Image(systemName: "checkmark.circle.fill").foregroundStyle(.green)
            case .failed:
                Image(systemName: "exclamationmark.circle.fill").foregroundStyle(.red)
            case .cancelled:
                Image(systemName: "slash.circle.fill").foregroundStyle(.secondary)
            default:
                EmptyView()
            }
        }
        .frame(width: 16, height: 16)
    }

    @ViewBuilder
    private var trailingControl: some View {
        switch model.state.phase {
        case .submitting, .working:
            Button("Stop", action: onStop)
                .buttonStyle(.plain)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(Color.remoraAccent)
                .frame(minHeight: PanelMetrics.minInteractiveTarget)
                .accessibilityLabel("Stop task")
        default:
            EmptyView()
        }
    }

    @ViewBuilder
    private var detail: some View {
        switch model.state {
        case .submitting:
            Text("Getting ready…")
                .font(.system(size: 12))
                .foregroundStyle(.secondary)

        case .working(_, let step, let progress):
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text(step)
                        .font(.system(size: 12))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                    Spacer()
                    if model.workingStepTotal > 0 {
                        Text("\(model.workingStepIndex)/\(model.workingStepTotal)")
                            .font(.system(size: 11, design: .monospaced))
                            .foregroundStyle(.secondary)
                    }
                }
                ProgressView(value: progress)
                    .progressViewStyle(.linear)
                    .tint(Color.remoraAccent)
            }

        case .succeeded(_, let summary):
            Text(summary)
                .font(.system(size: 12))
                .foregroundStyle(.secondary)

        case .failed(_, let message):
            VStack(alignment: .leading, spacing: 8) {
                Text(message)
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
                HStack(spacing: 8) {
                    Button("Try again", action: onRetry)
                    Button("Dismiss", action: onDismiss)
                }
                .controlSize(.small)
            }

        case .cancelled:
            Text("Stopped")
                .font(.system(size: 12))
                .foregroundStyle(.secondary)

        case .hidden, .ready:
            EmptyView()
        }
    }

    @ViewBuilder
    private var commandDisclosure: some View {
        if let command = model.visibleCommand {
            VStack(alignment: .leading, spacing: 4) {
                Button {
                    showsCommand.toggle()
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: showsCommand ? "chevron.down" : "chevron.right")
                            .font(.system(size: 9, weight: .semibold))
                        Text("Command")
                            .font(.system(size: 11))
                    }
                    .foregroundStyle(.secondary)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(showsCommand ? "Hide command" : "Show command")

                if showsCommand {
                    Text(command)
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                        .lineLimit(4)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }

    private var title: String {
        switch model.state.phase {
        case .submitting: return "Remora is starting…"
        case .working: return "Remora is working"
        case .succeeded: return "Done"
        case .failed: return "Could not finish"
        case .cancelled: return "Stopped"
        case .hidden, .ready: return "Remora"
        }
    }
}
