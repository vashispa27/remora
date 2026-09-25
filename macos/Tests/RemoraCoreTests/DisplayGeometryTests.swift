import CoreGraphics
import Testing
@testable import RemoraCore

@Suite
struct DisplayGeometryTests {
    private let primary = CGRect(x: 0, y: 0, width: 1920, height: 1080)
    // A display to the left of primary, with negative global coordinates.
    private let leftDisplay = CGRect(x: -1280, y: 0, width: 1280, height: 800)
    private let panel = CGSize(width: 420, height: 220)

    @Test func clampingKeepsMargin() {
        let clamped = DisplayGeometry.clampedPoint(CGPoint(x: -50, y: -50), in: primary)
        #expect(clamped.x == 12)
        #expect(clamped.y == 12)

        let clampedFar = DisplayGeometry.clampedPoint(CGPoint(x: 5000, y: 5000), in: primary)
        #expect(clampedFar.x == primary.maxX - 12)
        #expect(clampedFar.y == primary.maxY - 12)
    }

    @Test func clampingHandlesNegativeGlobalCoordinates() {
        let clamped = DisplayGeometry.clampedPoint(CGPoint(x: -5000, y: 100), in: leftDisplay)
        #expect(clamped.x == leftDisplay.minX + 12)
        #expect(clamped.y == 100)
    }

    @Test func clampingTinyFrameFallsBackToCenter() {
        let tiny = CGRect(x: 0, y: 0, width: 20, height: 20)
        let clamped = DisplayGeometry.clampedPoint(CGPoint(x: 5, y: 5), in: tiny)
        #expect(clamped.x == tiny.midX)
        #expect(clamped.y == tiny.midY)
    }

    @Test func preferredLowerRightPlacement() {
        let placement = DisplayGeometry.panelPlacement(
            pointerTip: CGPoint(x: 400, y: 600),
            panelSize: panel,
            visibleFrame: primary
        )
        #expect(placement.frame.minX == 400 + PanelMetrics.pointerGap)
        #expect(placement.frame.maxY == 600 - PanelMetrics.pointerGap)
        #expect(placement.horizontalFlip == false)
        #expect(placement.verticalFlip == false)
    }

    @Test func flipsNearRightEdge() {
        let placement = DisplayGeometry.panelPlacement(
            pointerTip: CGPoint(x: 1900, y: 600),
            panelSize: panel,
            visibleFrame: primary
        )
        #expect(placement.horizontalFlip)
        #expect(placement.frame.maxX < 1900)
        #expect(placement.frame.minX >= primary.minX + PanelMetrics.screenMargin)
    }

    @Test func flipsNearBottomEdge() {
        let placement = DisplayGeometry.panelPlacement(
            pointerTip: CGPoint(x: 400, y: 20),
            panelSize: panel,
            visibleFrame: primary
        )
        #expect(placement.verticalFlip)
        #expect(placement.frame.minY > 20)
        #expect(placement.frame.maxY <= primary.maxY - PanelMetrics.screenMargin)
    }

    @Test func flipsInBottomRightCorner() {
        let placement = DisplayGeometry.panelPlacement(
            pointerTip: CGPoint(x: 1915, y: 15),
            panelSize: panel,
            visibleFrame: primary
        )
        #expect(placement.horizontalFlip)
        #expect(placement.verticalFlip)
        assertWithinVisibleFrame(placement.frame, visibleFrame: primary)
    }

    @Test func placementStaysOnScreenForEveryCornerAndEdge() {
        let tips: [CGPoint] = [
            CGPoint(x: 0, y: 0),
            CGPoint(x: 1920, y: 0),
            CGPoint(x: 0, y: 1080),
            CGPoint(x: 1920, y: 1080),
            CGPoint(x: 960, y: 0),
            CGPoint(x: 960, y: 1080),
            CGPoint(x: 0, y: 540),
            CGPoint(x: 1920, y: 540)
        ]
        for tip in tips {
            let placement = DisplayGeometry.panelPlacement(
                pointerTip: tip,
                panelSize: panel,
                visibleFrame: primary
            )
            assertWithinVisibleFrame(placement.frame, visibleFrame: primary)
        }
    }

    @Test func placementOnSecondaryDisplayWithNegativeOrigin() {
        // Pointer near the right edge of a display whose origin is negative.
        let placement = DisplayGeometry.panelPlacement(
            pointerTip: CGPoint(x: -20, y: 400),
            panelSize: panel,
            visibleFrame: leftDisplay
        )
        assertWithinVisibleFrame(placement.frame, visibleFrame: leftDisplay)
        #expect(placement.horizontalFlip)
    }

    private func assertWithinVisibleFrame(_ frame: CGRect, visibleFrame: CGRect) {
        let margin = PanelMetrics.screenMargin
        #expect(frame.minX >= visibleFrame.minX + margin - 0.001)
        #expect(frame.maxX <= visibleFrame.maxX - margin + 0.001)
        #expect(frame.minY >= visibleFrame.minY + margin - 0.001)
        #expect(frame.maxY <= visibleFrame.maxY - margin + 0.001)
    }
}
