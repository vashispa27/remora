import CoreGraphics

public struct PanelPlacement: Equatable, Sendable {
    public var frame: CGRect
    public var horizontalFlip: Bool
    public var verticalFlip: Bool

    public init(frame: CGRect, horizontalFlip: Bool, verticalFlip: Bool) {
        self.frame = frame
        self.horizontalFlip = horizontalFlip
        self.verticalFlip = verticalFlip
    }
}

/// Pure global-coordinate helpers.
///
/// Every function here is deterministic and free of AppKit so it can be unit tested
/// with negative global coordinates (displays left/above the primary display).
public enum DisplayGeometry {
    /// Clamps a point into the visible frame, keeping at least `margin` from every edge.
    public static func clampedPoint(
        _ point: CGPoint,
        in visibleFrame: CGRect,
        margin: CGFloat = PanelMetrics.screenMargin
    ) -> CGPoint {
        guard visibleFrame.width > 2 * margin, visibleFrame.height > 2 * margin else {
            return CGPoint(x: visibleFrame.midX, y: visibleFrame.midY)
        }
        let minX = visibleFrame.minX + margin
        let maxX = visibleFrame.maxX - margin
        let minY = visibleFrame.minY + margin
        let maxY = visibleFrame.maxY - margin
        return CGPoint(
            x: min(max(point.x, minX), maxX),
            y: min(max(point.y, minY), maxY)
        )
    }

    /// Places the panel relative to the Remora pointer tip, preferring the lower-right.
    ///
    /// The result always lies inside `visibleFrame` inset by `margin`. Flips are
    /// reported so the caller can mirror the anchor-based appearance animation.
    public static func panelPlacement(
        pointerTip: CGPoint,
        pointerSize: CGSize = PanelMetrics.pointerSize,
        panelSize: CGSize,
        visibleFrame: CGRect,
        gap: CGFloat = PanelMetrics.pointerGap,
        margin: CGFloat = PanelMetrics.screenMargin
    ) -> PanelPlacement {
        let available = visibleFrame.insetBy(dx: margin, dy: margin)

        var origin = CGPoint(
            x: pointerTip.x + gap,
            y: pointerTip.y - gap - panelSize.height
        )
        var horizontalFlip = false
        var verticalFlip = false

        // Horizontal: prefer right, otherwise left, otherwise clamp.
        if origin.x + panelSize.width > available.maxX {
            let leftOriginX = pointerTip.x - gap - panelSize.width
            if leftOriginX >= available.minX {
                origin.x = leftOriginX
                horizontalFlip = true
            } else {
                origin.x = min(max(origin.x, available.minX), available.maxX - panelSize.width)
                horizontalFlip = origin.x < pointerTip.x
            }
        }

        // Vertical: preferred lower-right places the panel below the tip.
        if origin.y < available.minY {
            let aboveOriginY = pointerTip.y + gap
            if aboveOriginY + panelSize.height <= available.maxY {
                origin.y = aboveOriginY
                verticalFlip = true
            } else {
                origin.y = min(max(origin.y, available.minY), available.maxY - panelSize.height)
                verticalFlip = origin.y > pointerTip.y
            }
        }

        // Final safety clamp for frames larger than the available region.
        if origin.x < available.minX { origin.x = available.minX }
        if origin.y < available.minY { origin.y = available.minY }
        if origin.x + panelSize.width > available.maxX {
            origin.x = max(available.minX, available.maxX - panelSize.width)
        }
        if origin.y + panelSize.height > available.maxY {
            origin.y = max(available.minY, available.maxY - panelSize.height)
        }

        return PanelPlacement(
            frame: CGRect(origin: origin, size: panelSize),
            horizontalFlip: horizontalFlip,
            verticalFlip: verticalFlip
        )
    }
}
