import AppKit
import Foundation

// Synthetic source only; no WidgetKit registration, user files, or UI launch.
@main
struct WidgetMarkdownRegression {
    static func main() throws {
        let markdown = "````\n```\n- [ ] code\n~~~\n- [ ] still code\n````\n- [ ] actual"
        let tasks = WidgetMarkdown.pages(markdown, width: 300, height: 270).flatMap { $0 }.filter { $0.taskLine != nil }
        precondition(tasks.count == 1 && tasks[0].taskLine == 6)
        let crlf = WidgetMarkdown.pages("# 中文\r\n- [ ] 👨‍👩‍👧‍👦\r\n- [x] done", width: 300, height: 270).flatMap { $0 }.filter { $0.taskLine != nil }
        precondition(crlf.count == 2 && crlf[0].taskLine == 1 && crlf[1].taskChecked)
        let note = FolioWidgetNote(key: "note:40a88de0-7176-4be4-b4ea-c9155cae5ce4", title: "test", content: "test")
        precondition(note.link?.scheme == "folio")
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let file = directory.appendingPathComponent("notes.json")
        try JSONEncoder().encode(FolioWidgetSnapshot(notes: [note])).write(to: file, options: .atomic)
        precondition(FolioWidgetStore.readSnapshot(at: file).notes.count == 1)
        try Data("broken".utf8).write(to: file, options: .atomic)
        precondition(FolioWidgetStore.readSnapshot(at: file).notes.isEmpty)
        try FileManager.default.removeItem(at: file)
        precondition(FolioWidgetStore.readSnapshot(at: file).notes.isEmpty)
        print("Widget Markdown, source lines, URL identity and snapshot invalidation passed")
    }
}
