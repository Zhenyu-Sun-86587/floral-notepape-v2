import Foundation
import OSLog

struct FolioWidgetNote: Codable, Identifiable, Hashable {
    let key: String
    let title: String
    let content: String
    var id: String { key }
    var link: URL? {
        let parts = key.split(separator: ":", maxSplits: 1)
        guard parts.count == 2, ["note", "linked"].contains(String(parts[0])), UUID(uuidString: String(parts[1])) != nil else { return nil }
        let scheme = FolioWidgetStore.urlScheme
        return URL(string: "\(scheme)://widget-open/\(parts[0])/\(parts[1])")
    }
}

struct FolioWidgetDisplay: Codable {
    let noteKey: String?
    let textSize: String
}
struct FolioWidgetSnapshot: Codable {
    let notes: [FolioWidgetNote]
    let displays: [FolioWidgetDisplay]?
    init(notes: [FolioWidgetNote], displays: [FolioWidgetDisplay]? = nil) {
        self.notes = notes
        self.displays = displays
    }
    static let empty = FolioWidgetSnapshot(notes: [])
    func selectedNote(key: String?) -> FolioWidgetNote? {
        guard let key else { return nil }
        return notes.first { $0.key == key }
    }
    func display(slot: Int) -> FolioWidgetDisplay? {
        guard (1...4).contains(slot), let displays, displays.indices.contains(slot - 1) else { return nil }
        return displays[slot - 1]
    }
    func isDisplayed(key: String, slot: Int) -> Bool {
        display(slot: slot)?.noteKey == key && selectedNote(key: key) != nil
    }
}

struct FolioWidgetTaskChange: Codable {
    let noteKey: String
    let expectedContent: String
    let line: Int
    let checked: Bool
    var slot: Int? = nil
}

struct FolioWidgetOpenRequest: Encodable {
    let action = "openNote"
    let noteKey: String
    let slot: Int
}

enum FolioWidgetStore {
    static let widgetKinds = ["FolioNote", "FolioNote2", "FolioNote3", "FolioNote4"]
    // Storage choice does not define the app's URL identity.
    static var urlScheme: String {
        Bundle.main.bundleIdentifier?.hasPrefix("dev.folio.surface.containerexperiment") == true ? "folio-private" : "folio"
    }
    static let experimentLog = Logger(subsystem: "dev.folio.widget-container", category: "snapshot")
    private static let snapshotLock = NSLock()
    private static var cachedSnapshot: (url: URL, modified: Date, size: Int, inode: UInt64, snapshot: FolioWidgetSnapshot)?
    // Opt-in local experiment only. Normal signed builds keep the App Group
    // path; the experiment writes snapshots into the extension's own sandbox.
    static var privateContainerIdentifier: String? {
        guard let identifier = Bundle.main.object(forInfoDictionaryKey: "FolioWidgetPrivateContainer") as? String,
              let bundle = Bundle.main.bundleIdentifier,
              identifier == bundle || identifier == bundle + ".widgets" else { return nil }
        return identifier
    }
    static var defaults: UserDefaults? {
        if privateContainerIdentifier != nil { return .standard }
        guard let group = Bundle.main.object(forInfoDictionaryKey: "FolioAppGroup") as? String else { return nil }
        return UserDefaults(suiteName: group)
    }
    static func page(for key: String) -> Int { max(0, defaults?.integer(forKey: "page." + key) ?? 0) }
    static func setPage(_ page: Int, for key: String) {
        defaults?.set(max(0, min(4000, page)), forKey: "page." + key)
    }
    static func enqueueTask(_ change: FolioWidgetTaskChange) throws {
        try enqueueAction(change)
    }
    static func enqueueAction<T: Encodable>(_ change: T) throws {
        guard let container else { throw CocoaError(.fileNoSuchFile) }
        let inbox = container.appendingPathComponent("actions", isDirectory: true)
        try FileManager.default.createDirectory(at: inbox, withIntermediateDirectories: true)
        // Bound abandoned actions when the containing app is unavailable.
        let pending = try FileManager.default.contentsOfDirectory(at: inbox, includingPropertiesForKeys: nil)
        guard pending.filter({ $0.pathExtension == "json" }).count < 64 else { throw CocoaError(.fileWriteOutOfSpace) }
        let data = try JSONEncoder().encode(change)
        try data.write(to: inbox.appendingPathComponent(UUID().uuidString + ".json"), options: .atomic)
    }
    static var container: URL? {
        if let identifier = privateContainerIdentifier {
            let support: URL
            if identifier == Bundle.main.bundleIdentifier {
                // Resolve inside the actual sandbox instead of assuming the
                // filesystem path seen by the containing application.
                guard let url = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else { return nil }
                support = url
            } else {
                let data = FileManager.default.homeDirectoryForCurrentUser
                    .appendingPathComponent("Library/Containers/" + identifier + "/Data", isDirectory: true)
                // Never manufacture a fake sandbox before Launch Services has
                // created the extension's real container.
                guard FileManager.default.fileExists(atPath: data.path) else { return nil }
                support = data.appendingPathComponent("Library/Application Support", isDirectory: true)
            }
            return support.appendingPathComponent("FolioWidgets", isDirectory: true)
        }
        guard let group = Bundle.main.object(forInfoDictionaryKey: "FolioAppGroup") as? String,
              !group.isEmpty else { return nil }
        return FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group)
    }
    static func read() -> FolioWidgetSnapshot {
        guard let url = container?.appendingPathComponent("notes.json") else { return .empty }
        return readSnapshot(at: url)
    }
    // Atomic host writes replace the inode. Check metadata on every request so
    // removed permissions/content are never hidden by a time-based cache.
    static func readSnapshot(at url: URL) -> FolioWidgetSnapshot {
        snapshotLock.lock()
        defer { snapshotLock.unlock() }
        guard let attributes = try? FileManager.default.attributesOfItem(atPath: url.path),
              let modified = attributes[.modificationDate] as? Date,
              let size = attributes[.size] as? Int, size <= 1_048_576,
              let inode = attributes[.systemFileNumber] as? UInt64 else {
            cachedSnapshot = nil
            return .empty
        }
        if let cached = cachedSnapshot, cached.url == url, cached.modified == modified,
           cached.size == size, cached.inode == inode { return cached.snapshot }
        guard let bytes = try? Data(contentsOf: url), bytes.count <= 1_048_576,
              let snapshot = try? JSONDecoder().decode(FolioWidgetSnapshot.self, from: bytes) else {
            cachedSnapshot = nil
            return .empty
        }
        cachedSnapshot = (url, modified, size, inode, snapshot)
        if privateContainerIdentifier != nil {
            experimentLog.notice("READ_OK bundle=\(Bundle.main.bundleIdentifier ?? "unknown", privacy: .public) notes=\(snapshot.notes.count) bytes=\(bytes.count)")
        }
        return snapshot
    }
}
