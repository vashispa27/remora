import CoreGraphics

/// Layout constants shared by the panel and pointer windows.
public enum PanelMetrics {
    public static let targetWidth: CGFloat = 420
    public static let minWidth: CGFloat = 360
    public static let maxWidth: CGFloat = 520

    public static let cornerRadius: CGFloat = 16
    public static let controlCornerRadius: CGFloat = 10

    /// Gap between the pointer tip and the panel's nearest edge.
    public static let pointerGap: CGFloat = 14
    /// Minimum distance kept from every screen edge.
    public static let screenMargin: CGFloat = 12

    /// Rendered Remora pointer size. The arrow tip is the logical pointer position.
    public static let pointerSize = CGSize(width: 28, height: 34)

    /// The pointer window is larger than the pointer so badges can render without
    /// resizing the window.
    public static let pointerWindowSize = CGSize(width: 120, height: 120)

    public static let minInteractiveTarget: CGFloat = 28
}
