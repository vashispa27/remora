# Subtask 2 — Remora Pointer Overlay

Depends on: Subtask 1

## Objective

Replace the placeholder with a distinctive Remora agent pointer that can exist and move independently of the user's actual pointer.

## Pointer concept

The Remora pointer should read immediately as a second, software-controlled pointer:

- Use a familiar arrow/caret silhouette rather than a mascot illustration.
- Make it visually distinct from the macOS cursor through the aqua accent, a fine dark/light outline, and a small status dot.
- Target rendered size: approximately 28 × 34 pt.
- The visual tip of the arrow is the pointer's logical position.
- Keep the design sharp at Retina scale.

Do not hide or restyle the system cursor. Do not post mouse events. The Remora pointer is only an overlay view.

## Window behavior

- Use a borderless transparent window that can cross normal app content without changing it.
- Pointer-only areas ignore mouse events.
- The window floats above normal application windows but stays below security-sensitive system surfaces where macOS requires it.
- The pointer remains associated with the display on which it was invoked, unless a mock animation explicitly crosses displays.
- Spaces/fullscreen behavior should be documented and implemented using the least surprising native window-collection behavior.

## Pointer states

| State | Appearance |
|---|---|
| Ready | Solid accent pointer; subtle idle status dot |
| Submitting | One brief pulse at the status dot |
| Working | Status dot gently orbits/pulses; pointer remains crisp |
| Success | Small check appears beside pointer, then fades |
| Error | Small error badge; no shaking animation |
| Cancelled | Accent desaturates briefly before dismissal |

Respect the Reduce Motion accessibility setting. When enabled, replace travel and spring effects with short opacity transitions.

## Motion API

Implement view-only positioning:

```swift
struct AgentPointerPosition: Equatable {
    var globalPoint: CGPoint
}

protocol AgentPointerAnimating {
    func appear(at point: CGPoint) async
    func move(to point: CGPoint, duration: Duration) async
    func showResult(_ result: PointerResult) async
    func disappear() async
}
```

`move` changes only the overlay's rendered position. It must never call Core Graphics event-posting APIs or manipulate the physical cursor.

## Demo hooks

Add a debug-only menu that can preview:

- Every pointer state.
- A short three-point path.
- Motion with Reduce Motion enabled.
- Spawn positions near each screen edge.

## Acceptance criteria

- Remora pointer appears with its tip at the recorded invocation point.
- User's real pointer remains visible, movable, and clickable.
- Pointer overlay never intercepts clicks.
- Programmatic mock movement is smooth and ends at the exact requested point.
- State badges do not cause window-layout jumps.
- Pointer remains sharp in light mode, dark mode, and on Retina displays.
- Reduce Motion behavior contains no sweeping pointer travel.
