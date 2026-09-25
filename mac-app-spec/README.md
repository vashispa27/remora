# Remora macOS UI Prototype

Status: active implementation specification  
Scope: user interface and visual interaction only  
Platform: macOS 14 or later  
Suggested stack: Swift, SwiftUI, and AppKit

## Goal

Build a polished prototype of Remora's core interaction:

```text
Global shortcut
  -> Remora pointer appears at the current mouse location
  -> Command panel appears beside it
  -> User types a task and presses Return
  -> Panel becomes a compact activity card
  -> Remora pointer visually demonstrates doing the task
  -> Completion or error state appears
```

The Remora pointer is a separate on-screen agent pointer. It must not replace, hide, capture, or move the user's real mouse pointer.

## Strict scope

This phase contains UI only. Use deterministic mock data and timing for every post-submit state.

Included:

- Lightweight macOS menu-bar application.
- Global keyboard shortcut.
- Transparent overlay containing a Remora pointer.
- Floating command panel anchored to the Remora pointer.
- Ready, working, success, error, and cancelled visual states.
- Mock pointer motion and mock task progress.
- Keyboard, focus, animation, multi-display, and visual-polish work.

Excluded:

- Onboarding.
- Permission-request screens.
- Accessibility API control of other applications.
- Screen capture or OCR.
- Chrome extension communication.
- Networking, AI models, RAG, or task planning.
- Real clicks, typing, scrolling, or application control.
- Accounts, settings, persistence, saved skills, history, or analytics.
- Teach mode or multi-agent execution.

If an implementation choice requires defining how automation will work, stop at a protocol/interface stub and use a local mock.

## Implementation sequence

Each subtask should compile and run before the next begins:

1. [App shell and global shortcut](./01-app-shell-and-shortcut.md)
2. [Remora pointer overlay](./02-remora-pointer-overlay.md)
3. [Command panel](./03-command-panel.md)
4. [Mock task interaction](./04-mock-task-interaction.md)
5. [Polish and UI verification](./05-polish-and-verification.md)

## Visual direction

Remora should feel like a quiet native utility, not a chatbot window or dashboard.

- Compact, calm, and precise.
- Native macOS materials and typography.
- One restrained accent color used for the Remora pointer, focus, and progress.
- Soft shadow and subtle translucency; no heavy glassmorphism or neon glow.
- Motion communicates state and direction, never decoration.
- Light and dark appearances must both work.

Use a neutral system palette with a cool aqua accent as the initial theme:

| Token | Initial value |
|---|---|
| Accent | `#42C6B7` |
| Success | macOS system green |
| Error | macOS system red |
| Panel material | macOS HUD/window material |
| Main type | SF Pro / system font |
| Code/shortcut type | SF Mono / system monospaced font |
| Corner radius | 16 pt panel, 10 pt controls |

These are implementation defaults, not a permanent brand system.

## Shared UI model

Use one observable UI model with these states:

```swift
enum RemoraUIState: Equatable {
    case hidden
    case ready
    case submitting(command: String)
    case working(command: String, step: String, progress: Double)
    case succeeded(command: String, summary: String)
    case failed(command: String, message: String)
    case cancelled(command: String)
}
```

The mock execution driver is the only object allowed to advance post-submit states. It must expose a small interface that a future backend can replace without changing the views:

```swift
protocol TaskUIDriving {
    func start(command: String) async
    func cancel() async
}
```

This is a UI seam, not a backend contract. Do not add network or automation concepts to it.

## Global acceptance criteria

The UI prototype is complete when:

- The app launches without onboarding.
- `Command + Shift + Space` toggles Remora from any application.
- The Remora pointer spawns at the current real-pointer position.
- The panel is placed beside the Remora pointer and stays on-screen.
- The input receives focus immediately and accepts a task.
- Return begins the mock execution; `Shift + Return` inserts a newline.
- The Remora pointer moves independently through a mock path without moving or blocking the real pointer.
- Working, success, error, cancellation, and re-invocation are visually coherent.
- Escape dismisses the ready panel and cancels/dismisses appropriate transient states.
- The experience works on multiple displays and in light/dark appearance.
- No action affects another application's content.
- There are automated tests for the UI state model and positioning calculations.
