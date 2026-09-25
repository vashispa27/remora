import AppKit
import SwiftUI

enum RemoraTheme {
    static let accent = Color(red: 0x42 / 255.0, green: 0xC6 / 255.0, blue: 0xB7 / 255.0)
    static let accentNSColor = NSColor(
        srgbRed: 0x42 / 255.0,
        green: 0xC6 / 255.0,
        blue: 0xB7 / 255.0,
        alpha: 1
    )
}

extension Color {
    static let remoraAccent = RemoraTheme.accent
}
