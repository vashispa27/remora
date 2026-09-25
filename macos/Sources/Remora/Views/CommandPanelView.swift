import AppKit
import RemoraCore
import SwiftUI

/// The ready-state command surface. It emits events; it does not execute anything.
struct CommandPanelView: View {
    @ObservedObject var model: RemoraUIModel
    let context: FrontmostAppSummary?
    let reduceTransparency: Bool
    @Binding var isFocused: Bool
    let onSubmit: () -> Void
    let onDismiss: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            header
            editor
            footer
        }
        .padding(14)
        .frame(width: PanelMetrics.targetWidth)
        .background(PanelBackground(reduceTransparency: reduceTransparency))
    }

    private var header: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(Color.remoraAccent)
                .frame(width: 8, height: 8)
            Text("Remora")
                .font(.system(size: 13, weight: .semibold))

            Spacer()

            contextChip

            Button(action: onDismiss) {
                Image(systemName: "xmark")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(.secondary)
                    .frame(width: PanelMetrics.minInteractiveTarget, height: PanelMetrics.minInteractiveTarget)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .help("Close Remora")
            .accessibilityLabel("Close Remora")
        }
    }

    @ViewBuilder
    private var contextChip: some View {
        if let context {
            HStack(spacing: 5) {
                if let icon = AppIconProvider.icon(for: context) {
                    Image(nsImage: icon)
                        .resizable()
                        .aspectRatio(contentMode: .fit)
                        .frame(width: 14, height: 14)
                }
                Text(context.name)
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            .padding(.horizontal, 7)
            .padding(.vertical, 3)
            .background(
                Capsule().fill(Color.primary.opacity(0.06))
            )
            .accessibilityLabel("Current app: \(context.name)")
            .accessibilityElement(children: .ignore)
        }
    }

    private var editor: some View {
        ZStack(alignment: .topLeading) {
            if model.draft.isEmpty {
                Text("Tell Remora what to do…")
                    .font(.system(size: NSFont.systemFontSize))
                    .foregroundStyle(.secondary)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 8)
                    .allowsHitTesting(false)
            }

            CommandTextView(
                text: $model.draft,
                isFocused: $isFocused,
                isEditable: !model.isEditingLocked,
                maxLength: model.maxCommandLength,
                onSubmit: onSubmit,
                onEscape: onDismiss
            )
            .frame(minHeight: 44, maxHeight: 116)
        }
        .padding(6)
        .background(
            RoundedRectangle(cornerRadius: PanelMetrics.controlCornerRadius, style: .continuous)
                .fill(Color.primary.opacity(0.05))
        )
        .overlay(
            RoundedRectangle(cornerRadius: PanelMetrics.controlCornerRadius, style: .continuous)
                .stroke(isFocused ? Color.remoraAccent.opacity(0.9) : Color.primary.opacity(0.10), lineWidth: 1)
        )
        .accessibilityLabel("Task description")
    }

    private var footer: some View {
        HStack(spacing: 10) {
            Text("Return to run")
                .font(.system(size: 11))
                .foregroundStyle(.secondary)

            if model.shouldShowCharacterCount {
                Text("\(model.draft.count)/\(model.maxCommandLength)")
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundStyle(.secondary)
            }

            Spacer()

            Text("⇧↵ newline")
                .font(.system(size: 11, design: .monospaced))
                .foregroundStyle(.tertiary)

            Button(action: onSubmit) {
                Image(systemName: "arrow.right.circle.fill")
                    .font(.system(size: 18))
                    .foregroundStyle(model.canSubmit ? Color.remoraAccent : Color.secondary.opacity(0.5))
                    .frame(width: PanelMetrics.minInteractiveTarget, height: PanelMetrics.minInteractiveTarget)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(!model.canSubmit)
            .help("Run task")
            .accessibilityLabel("Run task")
        }
    }
}
