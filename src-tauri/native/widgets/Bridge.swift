import AppKit
import Darwin
import WidgetKit

typealias FolioOpenCallback = @convention(c) (UnsafePointer<CChar>) -> Void
// macOS 27 denies cross-container access without the old authorization prompt.
// Surface the actual operation failure; a registered extension is not evidence
// that the containing app can publish or consume actions in its container.
enum FolioWidgetBridgeDiagnostics {
    private static let lock = NSLock()
    private static var states = ["snapshot": "pending", "actions": "pending"]
    private static var failures: [String: String] = [:]
    static func isPermissionError(_ error: Error) -> Bool {
        let value = error as NSError
        if value.domain == NSCocoaErrorDomain && [257, 513].contains(value.code) { return true }
        if value.domain == NSPOSIXErrorDomain && [Int(EPERM), Int(EACCES)].contains(value.code) { return true }
        if let underlying = value.userInfo[NSUnderlyingErrorKey] as? NSError {
            return isPermissionError(underlying)
        }
        return false
    }
    static func success(_ operation: String) {
        lock.lock(); defer { lock.unlock() }
        states[operation] = "ready"
        failures.removeValue(forKey: operation)
    }
    static func failure(_ operation: String, _ error: Error) {
        let value = error as NSError
        let denied = isPermissionError(error)
        lock.lock()
        states[operation] = denied ? "denied" : "failed"
        failures[operation] = "\(value.domain):\(value.code)"
        lock.unlock()
        FolioWidgetStore.experimentLog.error("BRIDGE_FAILURE operation=\(operation) denied=\(denied) domain=\(value.domain) code=\(value.code)")
    }
    static func json() -> Data {
        lock.lock(); defer { lock.unlock() }
        return (try? JSONSerialization.data(withJSONObject: ["snapshot": states["snapshot"] ?? "pending", "actions": states["actions"] ?? "pending", "errors": failures])) ?? Data("{}".utf8)
    }
}
@_cdecl("folio_widgets_bridge_status")
func folioWidgetsBridgeStatus(_ output: UnsafeMutablePointer<CChar>, _ capacity: Int32) {
    let bytes = Array(FolioWidgetBridgeDiagnostics.json())
    guard capacity > bytes.count else { if capacity > 0 { output[0] = 0 }; return }
    for (index, byte) in bytes.enumerated() { output[index] = CChar(bitPattern: byte) }
    output[bytes.count] = 0
}

private enum FolioWidgetActionInbox {
    static let queue = DispatchQueue(label: "dev.folio.widget-actions")
    static var source: DispatchSourceFileSystemObject?
    static var callback: FolioOpenCallback?
    static func watch(_ container: URL) {
        queue.async {
            guard source == nil else { return }
            let inbox = container.appendingPathComponent("actions", isDirectory: true)
            do { try FileManager.default.createDirectory(at: inbox, withIntermediateDirectories: true) }
            catch { FolioWidgetBridgeDiagnostics.failure("actions", error); return }
            let descriptor = open(inbox.path, O_EVTONLY)
            guard descriptor >= 0 else {
                FolioWidgetBridgeDiagnostics.failure("actions", NSError(domain: NSPOSIXErrorDomain, code: Int(errno)))
                return
            }
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
            FolioWidgetBridgeDiagnostics.success("actions")
            drain(inbox)
        }
    }
    static func drain(_ inbox: URL) {
        let files: [URL]
        do {
            files = try FileManager.default.contentsOfDirectory(at: inbox, includingPropertiesForKeys: [.contentModificationDateKey, .fileSizeKey])
            FolioWidgetBridgeDiagnostics.success("actions")
        } catch { FolioWidgetBridgeDiagnostics.failure("actions", error); return }
        let pending = files.compactMap { file -> (URL, URLResourceValues)? in
            guard file.pathExtension == "json", UUID(uuidString: file.deletingPathExtension().lastPathComponent) != nil,
                  let values = try? file.resourceValues(forKeys: [.contentModificationDateKey, .fileSizeKey]) else { return nil }
            return (file, values)
        }.sorted { ($0.1.contentModificationDate ?? .distantPast) < ($1.1.contentModificationDate ?? .distantPast) }
        for (file, values) in pending.prefix(64) {
            guard let date = values.contentModificationDate, Date().timeIntervalSince(date) < 86400,
                  let size = values.fileSize, size <= 32768 else {
                try? FileManager.default.removeItem(at: file)
                continue
            }
            let data: Data
            do { data = try Data(contentsOf: file) }
            catch { FolioWidgetBridgeDiagnostics.failure("actions", error); continue }
            guard data.count <= 32768, let json = String(data: data, encoding: .utf8), callback != nil else { continue }
            json.withCString { callback?($0) }
            do { try FileManager.default.removeItem(at: file) }
            catch { FolioWidgetBridgeDiagnostics.failure("actions", error) }
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

func reloadFolioWidgets() {
    for kind in FolioWidgetStore.widgetKinds {
        WidgetCenter.shared.reloadTimelines(ofKind: kind)
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
        reloadFolioWidgets()
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
    let container: URL
    do { container = try FolioWidgetStore.resolveContainer() }
    catch { FolioWidgetBridgeDiagnostics.failure("snapshot", error); return false }
    guard let data = String(cString: json).data(using: .utf8) else { return false }
    let destination = container.appendingPathComponent("notes.json")
    FolioWidgetActionInbox.watch(container)
    if (try? Data(contentsOf: destination)) == data {
        // Readability alone does not prove write permission on macOS 27.
        // Verify atomic replacement once per process; later identical snapshots
        // remain deduplicated without a periodic write or refresh loop.
        if snapshotWriteVerified {
            FolioWidgetBridgeDiagnostics.success("snapshot")
            return true
        }
    }
    do {
        if FolioWidgetStore.privateContainerIdentifier != nil {
            try FileManager.default.createDirectory(at: container, withIntermediateDirectories: true)
        }
        try data.write(to: destination, options: .atomic)
        snapshotWriteVerified = true
        FolioWidgetBridgeDiagnostics.success("snapshot")
        if FolioWidgetStore.privateContainerIdentifier != nil {
            FolioWidgetStore.experimentLog.notice("WRITE_OK bytes=\(data.count)")
        }
        reloadFolioWidgets()
        return true
    } catch { FolioWidgetBridgeDiagnostics.failure("snapshot", error); return false }
}

// Rust serializes calls to folioWidgetsPublish with SNAPSHOT_WRITE_LOCK.
private var snapshotWriteVerified = false
