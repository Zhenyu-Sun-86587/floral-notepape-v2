import AppKit
import WidgetKit

typealias FolioOpenCallback = @convention(c) (UnsafePointer<CChar>) -> Void
private final class FolioURLHandler: NSObject {
    static let shared = FolioURLHandler()
    var callback: FolioOpenCallback?
    @objc func handle(_ event: NSAppleEventDescriptor, reply: NSAppleEventDescriptor) {
        // Consume legacy widget links without opening any note. Old archived
        // timelines can retain folio://note/... until WidgetKit refreshes them.
        let scheme = FolioWidgetStore.privateContainerIdentifier == nil ? "folio" : "folio-private"
        guard let url = event.paramDescriptor(forKeyword: 0x2D2D2D2D)?.stringValue,
              url.hasPrefix(scheme + "://widget-open/") else { return }
        url.withCString { callback?($0) }
    }
}

@_cdecl("folio_widgets_initialize")
func folioWidgetsInitialize(_ callback: FolioOpenCallback) {
    FolioURLHandler.shared.callback = callback
    NSAppleEventManager.shared().setEventHandler(
        FolioURLHandler.shared,
        andSelector: #selector(FolioURLHandler.handle(_:reply:)),
        forEventClass: 0x4755524C, andEventID: 0x4755524C)
    // Updating the extension must invalidate archived views even when notes.json
    // is unchanged. Publish deduplication alone cannot refresh a new UI build.
    if folioWidgetsAvailable() {
        WidgetCenter.shared.reloadTimelines(ofKind: "FolioNote")
    }
}

@_cdecl("folio_widgets_available")
func folioWidgetsAvailable() -> Bool {
    guard Bundle.main.builtInPlugInsURL?.appendingPathComponent("FolioWidgets.appex") != nil,
          let plugins = Bundle.main.builtInPlugInsURL,
          FileManager.default.fileExists(atPath: plugins.appendingPathComponent("FolioWidgets.appex").path)
    else { return false }
    return FolioWidgetStore.privateContainerIdentifier != nil || FolioWidgetStore.container != nil
}

@_cdecl("folio_widgets_publish")
func folioWidgetsPublish(_ json: UnsafePointer<CChar>) -> Bool {
    guard let container = FolioWidgetStore.container,
          let data = String(cString: json).data(using: .utf8) else { return false }
    let destination = container.appendingPathComponent("notes.json")
    if (try? Data(contentsOf: destination)) == data { return true }
    do {
        if FolioWidgetStore.privateContainerIdentifier != nil {
            try FileManager.default.createDirectory(at: container, withIntermediateDirectories: true)
        }
        try data.write(to: destination, options: .atomic)
        if FolioWidgetStore.privateContainerIdentifier != nil {
            FolioWidgetStore.experimentLog.notice("WRITE_OK bytes=\(data.count)")
        }
        WidgetCenter.shared.reloadTimelines(ofKind: "FolioNote")
        return true
    } catch { return false }
}
