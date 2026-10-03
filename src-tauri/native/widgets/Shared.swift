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
        let scheme = FolioWidgetStore.privateContainerIdentifier == nil ? "folio" : "folio-private"
        return URL(string: "\(scheme)://widget-open/\(parts[0])/\(parts[1])")
    }
}

struct FolioWidgetSnapshot: Codable {
    let notes: [FolioWidgetNote]
    static let empty = FolioWidgetSnapshot(notes: [])
}

enum FolioWidgetStore {
    static let experimentLog = Logger(subsystem: "dev.folio.widget-container", category: "snapshot")
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
        if privateContainerIdentifier != nil, let container {
            try? FileManager.default.createDirectory(at: container, withIntermediateDirectories: true)
        }
        guard let url = container?.appendingPathComponent("notes.json"),
              let bytes = try? Data(contentsOf: url), bytes.count <= 1_048_576,
              let snapshot = try? JSONDecoder().decode(FolioWidgetSnapshot.self, from: bytes)
        else { return .empty }
        if privateContainerIdentifier != nil {
            experimentLog.notice("READ_OK bundle=\(Bundle.main.bundleIdentifier ?? "unknown", privacy: .public) notes=\(snapshot.notes.count) bytes=\(bytes.count)")
        }
        return snapshot
    }
}
