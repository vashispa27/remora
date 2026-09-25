# Subtask 1 — App Shell and Global Shortcut

## Objective

Create the smallest running macOS application capable of living in the menu bar and toggling a placeholder Remora overlay with a global keyboard shortcut.

## Deliverables

- Xcode project under `macos/`.
- SwiftUI application lifecycle with an AppKit application delegate where needed.
- Menu-bar status item.
- Global shortcut registration.
- Placeholder borderless panel at the current pointer location.
- Shared `RemoraUIState` model initialized as `hidden`.
- Unit-test target and UI-test target.

## Behavior

### Launch

- Launch directly into the menu bar.
- Do not show onboarding, a welcome window, a permissions request, or a Dock window.
- A simple menu contains **Show Remora**, **Hide Remora**, and **Quit Remora**.
- The app may display a Dock icon in debug builds if that makes development easier; release-style behavior is menu-bar only.

### Shortcut

- Default shortcut: `Command + Shift + Space`.
- Pressing it while Remora is hidden changes the UI state to `ready` and shows the placeholder.
- Pressing it while Remora is visible dismisses Remora and returns to `hidden`.
- Repeated rapid presses must not create duplicate windows.
- Register the shortcut through a small abstraction so it can be replaced later; no shortcut settings screen is needed.

### Placeholder window

- Create a transparent, borderless, non-fullscreen overlay window.
- Place its initial anchor at the current global mouse location.
- Keep it inside the visible frame of the display containing that point.
- The placeholder can be a 44 pt accent circle for this subtask.
- The overlay must not activate or resize the frontmost application until the later command panel explicitly needs keyboard focus.

## Suggested types

```text
RemoraApp
AppDelegate
MenuBarController
GlobalShortcutController
OverlayWindowController
RemoraUIModel
DisplayGeometry
```

Keep global-coordinate conversion and visible-frame clamping in pure helper functions with unit tests.

## Non-goals

- Final pointer art.
- Command input.
- Animations beyond a simple appearance transition.
- Task execution or fake progress.
- Permissions and onboarding.
- Main settings window.

## Acceptance criteria

- Clean build and test from documented commands.
- The application starts without opening a normal window.
- Menu commands and global shortcut both toggle exactly one placeholder overlay.
- Overlay opens at the active display's current pointer location.
- It remains visible near all four screen edges and on secondary displays.
- Quitting removes the shortcut handler cleanly.
