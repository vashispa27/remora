# Subtask 3 — Command Panel

Depends on: Subtasks 1–2

## Objective

Create the compact command surface that appears next to the Remora pointer, accepts a task, and emits a submit event. It does not interpret or execute the task.

## Placement

- Anchor the panel 14 pt to the lower-right of the Remora pointer by default.
- Flip horizontally or vertically when the preferred placement would leave the display's visible frame.
- Maintain at least 12 pt of screen-edge margin.
- Panel and pointer may use separate windows, but must move and dismiss as one UI unit.
- Recalculate placement when the panel grows, the display changes, or the pointer moves.

## Ready-state layout

Target width: 420 pt. Minimum: 360 pt. Maximum: 520 pt.

```text
┌──────────────────────────────────────────────┐
│ ● Remora                   Current app  ×    │
│                                              │
│  What should I do?                           │
│  ┌────────────────────────────────────────┐  │
│  │ Create a DynamoDB table named…         │  │
│  └────────────────────────────────────────┘  │
│  Return to run            Shift↵ newline  ➜  │
└──────────────────────────────────────────────┘
```

Required controls:

- Remora identity/status label.
- Read-only context chip containing the frontmost application's icon/name when available. This is cosmetic context only; do not inspect its content.
- Close button.
- Multi-line text editor with placeholder `Tell Remora what to do…`.
- Submit button.
- Compact keyboard hint.

Do not add microphone, attachments, model picker, settings, history, workflow builder, or explain/circle controls in this phase.

## Input behavior

- Focus the editor when the panel appears.
- Preserve any draft only while the panel remains visible. Dismissing clears it.
- Return submits a non-empty trimmed command.
- `Shift + Return` inserts a newline.
- Submit button is disabled for empty/whitespace-only input.
- Escape dismisses the entire Remora UI while ready.
- `Command + A`, copy, cut, paste, undo, and redo use normal macOS text behavior.
- Cap the UI at 2,000 characters and show a subtle count only after 1,800.
- The panel grows from one to a maximum of five visible text lines, then scrolls internally.

## Focus and window behavior

- When invoked, preserve knowledge of the previously frontmost application for the context chip.
- Activate only enough to accept keyboard input.
- Closing returns focus to the prior application when possible.
- Clicking the pointer does nothing; clicking inside the panel behaves normally.
- Clicking elsewhere does not submit. It may leave the panel open for this prototype.

## Visual specification

- Use a native HUD/window material appropriate to the current appearance.
- 16 pt outer corner radius.
- One-pixel separator/border that remains visible on bright and dark backgrounds.
- Soft, compact shadow.
- System body typography; placeholder and keyboard hints use secondary text colors.
- Accent color is reserved for focus ring, status dot, and enabled submit button.
- Minimum interactive target: 28 × 28 pt for compact desktop controls, with accessible labels.

## Component boundary

Expose a view event instead of calling a service:

```swift
struct CommandPanelView: View {
    let context: FrontmostAppSummary?
    let onSubmit: (String) -> Void
    let onDismiss: () -> Void
}
```

## Acceptance criteria

- Shortcut invocation shows the pointer and focused command panel.
- Panel placement stays visible near every display edge.
- Return and submit button emit exactly one trimmed command.
- `Shift + Return` creates a newline without submitting.
- Empty input cannot submit.
- Escape and close dismiss the full UI and clear the draft.
- Keyboard editing works without trapping focus.
- VoiceOver identifies the editor, context chip, close button, and submit button.
- Layout works in light and dark mode and at supported panel widths.
