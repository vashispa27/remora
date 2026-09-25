# Subtask 5 — Polish and UI Verification

Depends on: Subtasks 1–4

## Objective

Make the UI-only prototype stable and presentation-ready without expanding its functionality.

## Visual polish

- Tune panel spacing, material, border, and shadow on light and dark desktops.
- Ensure the Remora pointer is legible over white, black, photographic, and high-saturation backgrounds.
- Keep transitions short and interruptible.
- Eliminate panel jumps when changing states.
- Avoid text truncation for expected English labels at default and larger accessibility text sizes.
- Use symbols consistently and provide accessible labels for symbol-only buttons.

## Motion guidelines

- Panel appearance: 120–180 ms fade/scale from the pointer anchor.
- Ready-to-working transformation: 180–240 ms.
- Mock pointer travel: 350–700 ms per segment depending on distance.
- Status/badge appearance: 120–180 ms.
- No infinite decorative animation except the subtle working indicator.
- All motion stops immediately when the UI is dismissed or the task is cancelled.
- Respect Reduce Motion and Reduce Transparency system preferences.

## Required test matrix

### Displays

- Primary display.
- Secondary display positioned left/right of primary.
- Retina and non-Retina scale when available.
- Invocation near each corner and screen edge.
- Display disconnected while Remora is visible; recover onto an available display.

### macOS environments

- Light appearance.
- Dark appearance.
- Reduce Motion.
- Reduce Transparency.
- Larger accessibility text sizes supported by the chosen controls.
- Fullscreen app and another Space, with any unavoidable limitation documented.

### Interaction

- Menu-bar invocation.
- Shortcut invocation and repeated rapid toggling.
- Empty, short, multiline, and 2,000-character commands.
- Submit, cancel, retry, success auto-dismiss, and explicit dismiss.
- Real mouse movement/clicking while mock execution is active.
- App quit during every UI state.

## Automated tests

Required unit tests:

- State-machine transitions.
- Cancellation invalidating pending mock events.
- Panel placement and horizontal/vertical flipping.
- Visible-frame clamping with negative global coordinates.
- Input trimming and character limit.
- Mock label selection.

Required UI tests:

- Invoke, type, submit, observe working, and finish.
- Cancel during work.
- Trigger debug failure and retry.
- Escape behavior in ready and transient states.
- Only one overlay/panel exists after repeated invocation.

Screenshot tests are encouraged for pointer/panel states in light and dark appearance, but they must not replace interaction tests.

## Documentation

Add `macos/README.md` containing:

- Supported macOS and Xcode versions used by the implementation.
- Build and test commands.
- How to run the UI prototype.
- Default shortcut.
- How to trigger debug success/failure/cancellation demos.
- Explicit statement that the prototype performs no real automation.
- Known window-level, fullscreen, and multi-display limitations.

## Final definition of done

- All five subtasks and automated tests pass from a clean checkout.
- The experience can be demonstrated in under one minute.
- There is no onboarding or permission UI.
- There are no AI, RAG, browser, network, persistence, or real automation dependencies.
- User input to other applications is never synthesized.
- The real pointer remains in the user's control throughout.
- UI state and motion remain coherent after cancellation and rapid re-invocation.
- Light/dark and reduced-motion/transparency modes are usable.
- Any remaining limitations are documented rather than silently worked around.
