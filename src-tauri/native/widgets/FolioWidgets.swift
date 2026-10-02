import AppIntents
import AppKit
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
    var rightLines: [WidgetMarkdownLine] = []
    var spread: Bool = false
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
struct CopyNoteText: AppIntent {
    static var title: LocalizedStringResource = "复制便签文字"
    static var openAppWhenRun: Bool = false
    @Parameter(title: "便签") var noteKey: String
    @Parameter(title: "文字") var text: String
    init() {}
    init(noteKey: String, text: String) { self.noteKey = noteKey; self.text = text }
    @MainActor func perform() async throws -> some IntentResult {
        // Removed sharing permission must also invalidate a cached copy button.
        guard FolioWidgetStore.read().notes.contains(where: { $0.key == noteKey }), !text.isEmpty else { return .result() }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(String(text.prefix(4000)), forType: .string)
        return .result()
    }
}
struct KeepWidgetVisible: AppIntent {
    static var title: LocalizedStringResource = "查看便签"
    static var openAppWhenRun: Bool = false
    func perform() async throws -> some IntentResult { .result() }
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
        let spread = context.family == .systemExtraLarge
        let width = spread ? (context.displaySize.width - 48) / 2 : context.displaySize.width - 32
        let pages = WidgetMarkdown.pages(note.content, width: width, height: context.displaySize.height - 82)
        let key = note.key + "." + String(context.family.rawValue)
        let step = spread ? 2 : 1
        let page = min(FolioWidgetStore.page(for: key), pages.count - 1) / step * step
        return NoteEntry(date: .now, note: note, lines: pages[page], rightLines: spread && page + 1 < pages.count ? pages[page + 1] : [], spread: spread, page: page, pageCount: pages.count, pageKey: key)
    }
}
struct NoteWidgetView: View {
    let entry: NoteEntry
    private var step: Int { entry.spread ? 2 : 1 }
    private var visibleText: String {
        (entry.lines + entry.rightLines).filter { !$0.rule }.map { String($0.text.characters) }.joined(separator: "\n")
    }
    private var pageLabel: String {
        entry.spread && entry.page + 1 < entry.pageCount
            ? "\(entry.page + 1)–\(entry.page + 2) / \(entry.pageCount)"
            : "\(entry.page + 1) / \(entry.pageCount)"
    }
    private func page(_ lines: [WidgetMarkdownLine]) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(lines) { line in
                if line.rule {
                    Divider().frame(height: line.height)
                } else {
                    Button(intent: CopyNoteText(noteKey: entry.note?.key ?? "", text: String(line.text.characters))) {
                      HStack(alignment: .top, spacing: 6) {
                        if line.quote { Rectangle().fill(.secondary).frame(width: 2) }
                        Text(line.text)
                            .font(.system(size: line.size, weight: line.heading ? .semibold : .regular, design: line.code ? .monospaced : .default))
                            .foregroundStyle(line.quote ? .secondary : .primary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                      }.frame(height: line.height, alignment: .top)
                       .contentShape(Rectangle()).allowsHitTesting(false)
                    }.buttonStyle(.plain).accessibilityLabel("复制这一段文字")
                }
            }
        }.frame(maxWidth: .infinity, alignment: .topLeading)
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(entry.note?.title ?? "选择一张便签")
                .font(.headline).lineLimit(1).widgetAccentable()
            if entry.note != nil {
                HStack(alignment: .top, spacing: 16) {
                    page(entry.lines)
                    if entry.spread { page(entry.rightLines) }
                }
            } else {
                Text("在笺影设置中选择便签，再编辑小组件。")
                    .font(.body).foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
            if entry.note != nil {
                HStack {
                  if entry.pageCount > 1 {
                    Button(intent: TurnNotePage(key: entry.pageKey, page: entry.page - step)) { Image(systemName: "chevron.left") }
                        .disabled(entry.page == 0).accessibilityLabel("上一页")
                    Spacer()
                    Text(pageLabel).font(.caption).foregroundStyle(.secondary)
                    Spacer()
                    Button(intent: TurnNotePage(key: entry.pageKey, page: entry.page + step)) { Image(systemName: "chevron.right") }
                        .disabled(entry.page + step >= entry.pageCount).accessibilityLabel("下一页")
                  } else { Spacer() }
                  Button(intent: CopyNoteText(noteKey: entry.note?.key ?? "", text: visibleText)) { Image(systemName: "doc.on.doc") }
                    .disabled(visibleText.isEmpty).accessibilityLabel("复制当前页文字")
                }.buttonStyle(.plain)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .clipped()
        .containerBackground(.background, for: .widget)
        // Consume clicks outside explicit controls; WidgetKit otherwise launches
        // the host for an ordinary background/text click even without widgetURL.
        .background {
            Button(intent: KeepWidgetVisible()) { Color.clear.contentShape(Rectangle()) }
                .buttonStyle(.plain)
        }
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
        .description("显示 Markdown 便签；点击段落复制文字，支持翻页和复制当前页。尺寸由系统管理。")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .systemExtraLarge])
    }
}
