import AppIntents
import SwiftUI
import WidgetKit

struct NoteEntity: AppEntity {
    static var typeDisplayRepresentation: TypeDisplayRepresentation = "便签"
    static var defaultQuery = NoteQuery()
    let id: String
    let title: String
    var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(title)") }
}
struct NoteQuery: EntityQuery {
    func entities(for identifiers: [String]) async throws -> [NoteEntity] {
        try await suggestedEntities().filter { identifiers.contains($0.id) }
    }
    func suggestedEntities() async throws -> [NoteEntity] {
        FolioWidgetStore.read().notes.map { NoteEntity(id: $0.key, title: $0.title) }
    }
    func defaultResult() async -> NoteEntity? { try? await suggestedEntities().first }
}
struct SelectNote: WidgetConfigurationIntent {
    static var title: LocalizedStringResource = "选择便签"
    static var description = IntentDescription("选择在笺影设置中允许显示的小组件便签。")
    @Parameter(title: "便签") var note: NoteEntity?
}
struct NoteEntry: TimelineEntry {
    let date: Date
    let note: FolioWidgetNote?
}
struct NoteProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> NoteEntry {
        NoteEntry(date: .now, note: FolioWidgetNote(key: "", title: "笺影", content: "记录此刻，留待回望。"))
    }
    func snapshot(for configuration: SelectNote, in context: Context) async -> NoteEntry { entry(configuration) }
    func timeline(for configuration: SelectNote, in context: Context) async -> Timeline<NoteEntry> {
        // Host publishes only on changes; no polling, capture, or animation timer.
        Timeline(entries: [entry(configuration)], policy: .never)
    }
    private func entry(_ configuration: SelectNote) -> NoteEntry {
        let notes = FolioWidgetStore.read().notes
        let note = configuration.note.map { selected in notes.first { $0.key == selected.id } } ?? notes.first
        return NoteEntry(date: .now, note: note)
    }
}
struct NoteWidgetView: View {
    let entry: NoteEntry
    @Environment(\.widgetFamily) private var family
    private var lineLimit: Int {
        switch family { case .systemSmall: return 6; case .systemMedium: return 6; case .systemLarge: return 18; default: return 28 }
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(entry.note?.title ?? "选择一张便签")
                .font(.headline).lineLimit(1).widgetAccentable()
            if let note = entry.note {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(Array(note.content.split(separator: "\n", omittingEmptySubsequences: false).prefix(lineLimit).enumerated()), id: \.offset) { _, raw in
                        let line = String(raw)
                        let heading = line.hasPrefix("# ") || line.hasPrefix("## ") || line.hasPrefix("### ")
                        let text = heading ? String(line.drop(while: { $0 == "#" || $0 == " " })) : line
                        Text((try? AttributedString(markdown: text, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(text))
                            .font(heading ? .headline : .body).lineLimit(3)
                    }
                }
            } else {
                Text("在笺影设置中选择便签，再编辑小组件。")
                    .font(.body).foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .clipped()
        .containerBackground(.background, for: .widget)
        .widgetURL(entry.note?.link)
        .privacySensitive()
    }
}
@main
struct FolioNoteWidget: Widget {
    var body: some WidgetConfiguration {
        AppIntentConfiguration(kind: "FolioNote", intent: SelectNote.self, provider: NoteProvider()) { entry in
            NoteWidgetView(entry: entry)
        }
        .configurationDisplayName("笺影便签")
        .description("将选定便签放在桌面或通知中心，点击打开便签。")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .systemExtraLarge])
    }
}
