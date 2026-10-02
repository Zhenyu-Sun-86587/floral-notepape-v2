import AppKit
import WidgetKit

private final class FolioURLHandler: NSObject {
    static let shared = FolioURLHandler()
    @objc func handle(_ event: NSAppleEventDescriptor, reply: NSAppleEventDescriptor) {
        // Consume legacy widget links without opening any note. Old archived
        // timelines can retain folio://note/... until WidgetKit refreshes them.
    }
}

@_cdecl("folio_widgets_initialize")
func folioWidgetsInitialize() {
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
    return FolioWidgetStore.container != nil
}

@_cdecl("folio_widgets_publish")
func folioWidgetsPublish(_ json: UnsafePointer<CChar>) -> Bool {
    guard let container = FolioWidgetStore.container,
          let data = String(cString: json).data(using: .utf8) else { return false }
    let destination = container.appendingPathComponent("notes.json")
    if (try? Data(contentsOf: destination)) == data { return true }
    do {
        try data.write(to: destination, options: .atomic)
        WidgetCenter.shared.reloadTimelines(ofKind: "FolioNote")
        return true
    } catch { return false }
}
