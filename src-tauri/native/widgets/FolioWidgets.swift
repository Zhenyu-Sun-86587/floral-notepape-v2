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
    var lines: [WidgetMarkdownLine] = []
    var page: Int = 0
    var pageCount: Int = 1
    var pageKey: String = ""
}
struct TurnNotePage: AppIntent {
    static var title: LocalizedStringResource = "翻阅便签"
    static var openAppWhenRun: Bool = false
    @Parameter(title: "便签页面") var key: String
    @Parameter(title: "页码") var page: Int
    init() {}
    init(key: String, page: Int) { self.key = key; self.page = page }
    func perform() async throws -> some IntentResult {
        FolioWidgetStore.setPage(page, for: key)
        WidgetCenter.shared.reloadTimelines(ofKind: "FolioNote")
        return .result()
    }
}
struct NoteProvider: AppIntentTimelineProvider {
    func placeholder(in context: Context) -> NoteEntry {
        NoteEntry(date: .now, note: FolioWidgetNote(key: "", title: "笺影", content: "记录此刻，留待回望。"))
    }
    func snapshot(for configuration: SelectNote, in context: Context) async -> NoteEntry { entry(configuration, context: context) }
    func timeline(for configuration: SelectNote, in context: Context) async -> Timeline<NoteEntry> {
        // Host publishes only on changes; no polling, capture, or animation timer.
        Timeline(entries: [entry(configuration, context: context)], policy: .never)
    }
    private func entry(_ configuration: SelectNote, context: Context) -> NoteEntry {
        let notes = FolioWidgetStore.read().notes
        let note = configuration.note.map { selected in notes.first { $0.key == selected.id } } ?? notes.first
        guard let note else { return NoteEntry(date: .now, note: nil) }
        let pages = WidgetMarkdown.pages(note.content, width: context.displaySize.width - 32, height: context.displaySize.height - 82)
        let key = note.key + "." + String(context.family.rawValue)
        let page = min(FolioWidgetStore.page(for: key), pages.count - 1)
        return NoteEntry(date: .now, note: note, lines: pages[page], page: page, pageCount: pages.count, pageKey: key)
    }
}
struct NoteWidgetView: View {
    let entry: NoteEntry
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(entry.note?.title ?? "选择一张便签")
                .font(.headline).lineLimit(1).widgetAccentable()
            if entry.note != nil {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(entry.lines) { line in
                        if line.rule {
                            Divider().frame(height: line.height)
                        } else {
                            HStack(alignment: .top, spacing: 6) {
                                if line.quote { Rectangle().fill(.secondary).frame(width: 2) }
                                Text(line.text)
                                    .font(.system(size: line.size, weight: line.heading ? .semibold : .regular, design: line.code ? .monospaced : .default))
                                    .foregroundStyle(line.quote ? .secondary : .primary)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }.frame(height: line.height, alignment: .top)
                        }
                    }
                }
            } else {
                Text("在笺影设置中选择便签，再编辑小组件。")
                    .font(.body).foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
            if entry.note != nil && entry.pageCount > 1 {
                HStack {
                    Button(intent: TurnNotePage(key: entry.pageKey, page: entry.page - 1)) { Image(systemName: "chevron.left") }
                        .disabled(entry.page == 0).accessibilityLabel("上一页")
                    Spacer()
                    Text("\(entry.page + 1) / \(entry.pageCount)").font(.caption).foregroundStyle(.secondary)
                    Spacer()
                    Button(intent: TurnNotePage(key: entry.pageKey, page: entry.page + 1)) { Image(systemName: "chevron.right") }
                        .disabled(entry.page + 1 == entry.pageCount).accessibilityLabel("下一页")
                }.buttonStyle(.plain)
            }
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
        .description("显示 Markdown 便签，长内容可翻页；点击正文打开便签。尺寸由系统管理。")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .systemExtraLarge])
    }
}
