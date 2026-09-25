import AppKit
import SwiftUI

/// Multi-line command editor backed by `NSTextView`.
///
/// `NSTextView` is required because SwiftUI's `TextEditor` cannot distinguish Return
/// (submit) from Shift + Return (newline). This view posts an event instead of
/// interpreting the command.
struct CommandTextView: NSViewRepresentable {
    @Binding var text: String
    @Binding var isFocused: Bool
    var isEditable: Bool
    var maxLength: Int
    var onSubmit: () -> Void
    var onEscape: () -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    func makeNSView(context: Context) -> NSScrollView {
        let scrollView = NSScrollView()
        scrollView.drawsBackground = false
        scrollView.hasVerticalScroller = true
        scrollView.autohidesScrollers = true
        scrollView.borderType = .noBorder

        let textView = NSTextView()
        textView.delegate = context.coordinator
        textView.drawsBackground = false
        textView.isRichText = false
        textView.isAutomaticQuoteSubstitutionEnabled = false
        textView.isAutomaticDashSubstitutionEnabled = false
        textView.isAutomaticTextReplacementEnabled = false
        textView.allowsUndo = true
        textView.font = .systemFont(ofSize: NSFont.systemFontSize)
        textView.textContainerInset = NSSize(width: 2, height: 6)
        textView.isVerticallyResizable = true
        textView.isHorizontallyResizable = false
        textView.autoresizingMask = [.width]
        textView.textContainer?.widthTracksTextView = true
        textView.string = text

        scrollView.documentView = textView
        context.coordinator.textView = textView
        return scrollView
    }

    func updateNSView(_ scrollView: NSScrollView, context: Context) {
        context.coordinator.parent = self
        guard let textView = scrollView.documentView as? NSTextView else { return }

        if textView.string != text {
            textView.string = text
        }
        textView.isEditable = isEditable
        applyFocus(to: textView, in: scrollView)
    }

    private func applyFocus(to textView: NSTextView, in scrollView: NSScrollView) {
        guard isFocused, let window = scrollView.window else { return }
        if window.firstResponder !== textView {
            DispatchQueue.main.async {
                window.makeFirstResponder(textView)
            }
        }
    }

    @MainActor
    final class Coordinator: NSObject, NSTextViewDelegate {
        var parent: CommandTextView
        weak var textView: NSTextView?

        init(_ parent: CommandTextView) {
            self.parent = parent
        }

        func textDidChange(_ notification: Notification) {
            guard let textView = notification.object as? NSTextView else { return }
            var value = textView.string
            if value.count > parent.maxLength {
                value = String(value.prefix(parent.maxLength))
                textView.string = value
            }
            if parent.text != value {
                parent.text = value
            }
        }

        func textView(_ textView: NSTextView, doCommandBy commandSelector: Selector) -> Bool {
            if commandSelector == #selector(NSResponder.insertNewline(_:)) {
                let isShift = NSApp.currentEvent?.modifierFlags.contains(.shift) ?? false
                if isShift {
                    textView.insertText("\n", replacementRange: textView.selectedRange())
                } else {
                    parent.onSubmit()
                }
                return true
            }

            if commandSelector == #selector(NSResponder.insertNewlineIgnoringFieldEditor(_:)) {
                textView.insertText("\n", replacementRange: textView.selectedRange())
                return true
            }

            if commandSelector == #selector(NSResponder.cancelOperation(_:)) {
                parent.onEscape()
                return true
            }

            return false
        }
    }
}
