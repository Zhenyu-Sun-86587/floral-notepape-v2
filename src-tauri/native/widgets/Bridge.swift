import AppKit
import Darwin
import WidgetKit

typealias FolioOpenCallback = @convention(c) (UnsafePointer<CChar>) -> Void
private enum FolioWidgetActionInbox {
    static let queue = DispatchQueue(label: "dev.folio.widget-actions")
    static var source: DispatchSourceFileSystemObject?
    static var callback: FolioOpenCallback?
    static func watch(_ container: URL) {
        queue.async {
            guard source == nil else { return }
            let inbox = container.appendingPathComponent("actions", isDirectory: true)
            do { try FileManager.default.createDirectory(at: inbox, withIntermediateDirectories: true) }
            catch { return }
            let descriptor = open(inbox.path, O_EVTONLY)
            guard descriptor >= 0 else { return }
            let watcher = DispatchSource.makeFileSystemObjectSource(fileDescriptor: descriptor, eventMask: [.write, .delete, .rename], queue: queue)
            watcher.setEventHandler {
                if !watcher.data.intersection([.delete, .rename]).isEmpty {
                    watcher.setEventHandler(handler: nil)
                    watcher.cancel()
                    source = nil
                    watch(container)
                    return
                }
                drain(inbox)
            }
            watcher.setCancelHandler { close(descriptor) }
            source = watcher
            watcher.resume()
            drain(inbox)
        }
    }
    static func drain(_ inbox: URL) {
        guard let files = try? FileManager.default.contentsOfDirectory(at: inbox, includingPropertiesForKeys: [.contentModificationDateKey, .fileSizeKey]) else { return }
        for file in files.filter({ $0.pathExtension == "json" }).sorted(by: {
            let left = (try? $0.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
            let right = (try? $1.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
            return left < right
        }).prefix(64) {
            guard UUID(uuidString: file.deletingPathExtension().lastPathComponent) != nil else { continue }
            defer { try? FileManager.default.removeItem(at: file) }
            guard let values = try? file.resourceValues(forKeys: [.contentModificationDateKey, .fileSizeKey]),
                  let date = values.contentModificationDate, Date().timeIntervalSince(date) < 86400,
                  let size = values.fileSize, size <= 32768,
                  let data = try? Data(contentsOf: file), data.count <= 32768,
                  let json = String(data: data, encoding: .utf8) else { continue }
            json.withCString { callback?($0) }
        }
    }
}
private final class FolioURLHandler: NSObject {
    static let shared = FolioURLHandler()
    var callback: FolioOpenCallback?
    @objc func handle(_ event: NSAppleEventDescriptor, reply: NSAppleEventDescriptor) {
        // Consume legacy widget links without opening any note. Old archived
        // timelines can retain folio://note/... until WidgetKit refreshes them.
        let scheme = FolioWidgetStore.urlScheme
        guard let url = event.paramDescriptor(forKeyword: 0x2D2D2D2D)?.stringValue,
              url.hasPrefix(scheme + "://widget-open/") else { return }
        url.withCString { callback?($0) }
    }
}

@_cdecl("folio_widgets_initialize")
func folioWidgetsInitialize(_ callback: FolioOpenCallback, _ taskCallback: FolioOpenCallback) {
    FolioURLHandler.shared.callback = callback
    FolioWidgetActionInbox.callback = taskCallback
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
    FolioWidgetActionInbox.watch(container)
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
