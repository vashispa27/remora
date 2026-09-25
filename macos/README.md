# Remora macOS UI Prototype

Implements the five subtasks in [`../mac-app-spec/`](../mac-app-spec/README.md).

This is a **UI-only** prototype. It performs no real automation, inspects no other
application, invokes no model, and posts no input events. Every post-submit state is
driven by a deterministic mock (`MockTaskUIDriver`).

## Toolchain used

The implementation was built and tested with:

- macOS 26.5.1
- Apple Swift 6.3.2 (Command Line Tools only — no Xcode installed)
- Swift tools version 5.9, deployment target macOS 14

An Xcode build environment works too. Because this machine has only the Command Line
Tools, the Swift Testing framework lives outside the default search paths. The
`scripts/test.sh` wrapper supplies those paths. When Xcode is present the wrapper skips
them automatically.

## Build and test

```sh
swift build              # compile RemoraCore + the Remora app
./scripts/test.sh        # run the unit tests (wraps `swift test` for CLT-only machines)
./scripts/build-app.sh   # assemble .build/Remora.app
```

Or with `make`:

```sh
make build
make test
make app
make run
```

## Running the prototype

```sh
./scripts/build-app.sh
open .build/Remora.app
```

The app has no Dock icon and no window. It lives in the menu bar. Quit it from the menu
bar (**Quit Remora**) or with `pkill -f Remora.app`.

### Default shortcut

`Command + Shift + Space` toggles Remora from any application.

- Hidden → shows the pointer and the command panel.
- Ready → dismisses.
- While a mock run is active → brings the activity card forward.
- Terminal state → dismisses.

The menu bar offers **Show Remora** / **Hide Remora** as an alternative.

### Second shortcut (permission-free)

`Control + Option + R` summons Remora at the current pointer location. If the UI is
already visible it is brought forward instead of starting a new run.

This is an ordinary key combination registered through Carbon, the same mechanism as
`⌘⇧Space`, so it needs **no Accessibility or Input Monitoring permission**. A bare
modifier key (such as double-tapping right Command) cannot be a Carbon hot key and would
require a global key monitor plus Accessibility permission, so it is intentionally not
used.

## Demonstrating success, failure, and cancellation

Use the **Debug** submenu in the menu bar:

- **Force Next Run: Failure** — the next submitted task ends in the failure card with
  **Try again** / **Dismiss**.
- **Force Next Run: Cancellation** — the next run stops after its first step.
- **Cancel Current Run** — same as the **Stop** button.
- **Preview Pointer: …** — shows each pointer state (ready, submitting, working,
  success, error, cancelled).
- **Preview Three-Point Path** / **Preview Near … Edge** — pointer motion checks.
- **Preview With Reduce Motion** — stationary-pointer behavior.

A normal submission shows three deterministic steps and then `Done` / `Demo complete`.
Success auto-dismisses after 2.5 s unless the card is hovered or focused. Cancellation
shows `Stopped` for about 1 s.

## Tests

`./scripts/test.sh` runs 40 unit tests across five suites:

- State-machine transitions (allowed and rejected).
- Panel placement, flipping, and visible-frame clamping with negative global coordinates.
- Input trimming, character limit, and model transitions.
- Mock-driver label selection, ordering, failure, and cancellation.
- End-to-end session flow (submit → steps → success, stop, retry, dismiss, auto-dismiss).

`UITests/RemoraUITests.swift` contains the required XCUITest scenarios as a reviewable
artifact. XCUITest needs an Xcode app-host target, so it is **not** compiled or run by
Swift Package Manager in this environment. See the limitations below.

## Architecture

```
Sources/RemoraCore        UI-framework-agnostic, fully unit tested
  RemoraUIState           state enum + pure transition rules
  RemoraUIModel           observable model (single source of truth)
  RemoraSessionController driver <-> model <-> pointer orchestration
  MockTaskUIDriver        deterministic, cancellable mock run
  DisplayGeometry         panel placement + clamping
  TaskUIDriving           seam a real backend can replace later

Sources/Remora            AppKit + SwiftUI shell
  App/                    SwiftUI app, AppDelegate, coordinator, menu bar, shortcut
  Windows/                pointer overlay and panel windows (NSPanel)
  Views/                  pointer art, command panel, activity card, editor
```

The profile of the interaction lives in `RemoraCore` so it can be tested without a
window server. The AppKit layer only supplies real windows, the frontmost-app context,
and the visible frame.

## Known limitations

- **XCUITest requires Xcode.** Swift Package Manager cannot host a UI test bundle, so the
  UI tests cannot execute on a Command Line Tools-only machine. The unit tests cover the
  state machine, geometry, and full mock flow instead.
- **Fullscreen spaces.** The overlay uses
  `[.canJoinAllSpaces, .fullScreenAuxiliary, .stationary]` and floats at `.floating`
  level. It is intentionally kept below security-sensitive system surfaces. Over a
  fullscreen app on a different Space it may not be visible until that Space is active.
- **Nonactivating panel.** The panel is a `.nonactivatingPanel` so the previously
  frontmost application stays frontmost and the context chip is accurate. The panel
  becomes key to accept typing without activating Remora.
- **Panel sizing.** Height is derived from the SwiftUI content's intrinsic size. With
  very large accessibility text sizes the activity card may need more room than the
  fixed 392 pt width allows; text is allowed to wrap rather than truncate.
- **Multi-display.** Placement uses the visible frame of the display containing the
  recorded invocation point. If that display is disconnected while the UI is visible, a
  subsequent layout falls back to the main screen.
- **Reduce Motion** replaces pointer travel with stationary labels/progress and short
  opacity changes.
- **Shortcuts are permission-free.** Both `⌘⇧Space` and `⌃⌥R` are Carbon hot keys, so the
  app never requests Accessibility or Input Monitoring access and never monitors global
  key events.
- **Context chip** reads only the frontmost application's name and bundle identifier for
  cosmetic display. It never inspects windows, controls, or content.
- The `README` of the repository notes the deferred `SHARED_INTEGRATION_SPEC.md` and
  `TASK_2_CHROME_EXTENSION_SPEC.md`; neither is implemented or referenced here.
