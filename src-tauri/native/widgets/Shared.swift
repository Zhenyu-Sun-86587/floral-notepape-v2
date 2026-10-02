import Foundation

struct FolioWidgetNote: Codable, Identifiable, Hashable {
    let key: String
    let title: String
    let content: String
    var id: String { key }
    var link: URL? {
        let parts = key.split(separator: ":", maxSplits: 1)
        guard parts.count == 2, UUID(uuidString: String(parts[1])) != nil else { return nil }
        return URL(string: "folio://\(parts[0])/\(parts[1])")
    }
}

struct FolioWidgetSnapshot: Codable {
    let notes: [FolioWidgetNote]
    static let empty = FolioWidgetSnapshot(notes: [])
}

enum FolioWidgetStore {
    static var defaults: UserDefaults? {
        guard let group = Bundle.main.object(forInfoDictionaryKey: "FolioAppGroup") as? String else { return nil }
        return UserDefaults(suiteName: group)
    }
    static func page(for key: String) -> Int { max(0, defaults?.integer(forKey: "page." + key) ?? 0) }
    static func setPage(_ page: Int, for key: String) {
        defaults?.set(max(0, min(4000, page)), forKey: "page." + key)
    }
    static var container: URL? {
        guard let group = Bundle.main.object(forInfoDictionaryKey: "FolioAppGroup") as? String,
              !group.isEmpty else { return nil }
        return FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: group)
    }
    static func read() -> FolioWidgetSnapshot {
        guard let url = container?.appendingPathComponent("notes.json"),
              let bytes = try? Data(contentsOf: url), bytes.count <= 1_048_576,
              let snapshot = try? JSONDecoder().decode(FolioWidgetSnapshot.self, from: bytes)
        else { return .empty }
        return snapshot
    }
}
