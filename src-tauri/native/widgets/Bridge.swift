import AppKit
import WidgetKit

typealias FolioURLCallback = @convention(c) (UnsafePointer<CChar>) -> Void

private final class FolioURLHandler: NSObject {
    static let shared = FolioURLHandler()
    var callback: FolioURLCallback?
    @objc func handle(_ event: NSAppleEventDescriptor, reply: NSAppleEventDescriptor) {
        guard let url = event.paramDescriptor(forKeyword: 0x2D2D2D2D)?.stringValue else { return }
        url.withCString { callback?($0) }
    }
}

@_cdecl("folio_widgets_register_urls")
func folioWidgetsRegisterURLs(_ callback: FolioURLCallback) {
    FolioURLHandler.shared.callback = callback
    NSAppleEventManager.shared().setEventHandler(
        FolioURLHandler.shared,
        andSelector: #selector(FolioURLHandler.handle(_:reply:)),
        forEventClass: 0x4755524C, andEventID: 0x4755524C)
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
