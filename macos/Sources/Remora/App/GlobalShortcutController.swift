import AppKit
import Carbon.HIToolbox
import os

private let shortcutLogger = Logger(subsystem: "com.remora.prototype", category: "shortcut")

/// A single global hot key binding.
struct ShortcutDefinition {
    let id: UInt32
    let keyCode: UInt32
    let modifiers: UInt32
    let onInvoke: () -> Void
}

/// Small seam so the shortcut mechanism can be replaced later without touching the UI.
@MainActor
protocol ShortcutRegistering: AnyObject {
    @discardableResult
    func register(_ definitions: [ShortcutDefinition]) -> Bool
    func unregister()
}

/// Registers global hot keys through Carbon.
///
/// Carbon hot keys require no Accessibility or Input Monitoring permission, unlike
/// global key-event monitors. Only ordinary key combinations can be registered; a bare
/// modifier key cannot be a Carbon hot key.
@MainActor
final class GlobalShortcutController: ShortcutRegistering {
    // 'RMRA'
    private static let signature: OSType = 0x524D_5241

    private var hotKeyRefs: [EventHotKeyRef] = []
    private var eventHandlerRef: EventHandlerRef?
    private var handlers: [UInt32: () -> Void] = [:]

    @discardableResult
    func register(_ definitions: [ShortcutDefinition]) -> Bool {
        unregister()

        var eventType = EventTypeSpec(
            eventClass: OSType(kEventClassKeyboard),
            eventKind: UInt32(kEventHotKeyPressed)
        )

        let context = Unmanaged.passUnretained(self).toOpaque()
        let handlerStatus = InstallEventHandler(
            GetApplicationEventTarget(),
            { _, event, userData -> OSStatus in
                guard let userData, let event else { return OSStatus(eventNotHandledErr) }

                var hotKeyID = EventHotKeyID()
                let parameterStatus = GetEventParameter(
                    event,
                    EventParamName(kEventParamDirectObject),
                    EventParamType(typeEventHotKeyID),
                    nil,
                    MemoryLayout<EventHotKeyID>.size,
                    nil,
                    &hotKeyID
                )
                guard parameterStatus == noErr else { return parameterStatus }

                let controller = Unmanaged<GlobalShortcutController>
                    .fromOpaque(userData)
                    .takeUnretainedValue()
                // Carbon hot-key handlers run on the main thread.
                MainActor.assumeIsolated {
                    controller.invoke(id: hotKeyID.id)
                }
                return noErr
            },
            1,
            &eventType,
            context,
            &eventHandlerRef
        )
        guard handlerStatus == noErr else { return false }

        for definition in definitions {
            var hotKeyRef: EventHotKeyRef?
            let hotKeyID = EventHotKeyID(signature: Self.signature, id: definition.id)
            let status = RegisterEventHotKey(
                definition.keyCode,
                definition.modifiers,
                hotKeyID,
                GetApplicationEventTarget(),
                0,
                &hotKeyRef
            )
            guard status == noErr, let hotKeyRef else {
                shortcutLogger.error("Failed to register hot key id \(definition.id, privacy: .public)")
                unregister()
                return false
            }
            hotKeyRefs.append(hotKeyRef)
            handlers[definition.id] = definition.onInvoke
            shortcutLogger.notice("Registered hot key id \(definition.id, privacy: .public)")
        }

        return true
    }

    func unregister() {
        for hotKeyRef in hotKeyRefs {
            UnregisterEventHotKey(hotKeyRef)
        }
        hotKeyRefs.removeAll()
        handlers.removeAll()

        if let eventHandlerRef {
            RemoveEventHandler(eventHandlerRef)
            self.eventHandlerRef = nil
        }
    }

    private func invoke(id: UInt32) {
        shortcutLogger.notice("Hot key invoked id \(id, privacy: .public)")
        handlers[id]?()
    }
}
