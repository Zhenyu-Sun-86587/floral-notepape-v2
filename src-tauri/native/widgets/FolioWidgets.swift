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
enum NoteTextSize: String, AppEnum {
    case compact, standard, large
    static var typeDisplayRepresentation: TypeDisplayRepresentation = "字号"
    static var caseDisplayRepresentations: [Self: DisplayRepresentation] = [.compact: "紧凑", .standard: "标准", .large: "大字"]
    var points: CGFloat { switch self { case .compact: return 12; case .standard: return 13; case .large: return 15 } }
}
struct SelectNote: WidgetConfigurationIntent {
    static var title: LocalizedStringResource = "选择便签"
    static var description = IntentDescription("选择在笺影设置中允许显示的小组件便签。")
    @Parameter(title: "便签") var note: NoteEntity?
    @Parameter(title: "字号", default: .standard) var textSize: NoteTextSize
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
struct ToggleNoteTask: AppIntent {
    static var title: LocalizedStringResource = "切换待办状态"
    static var openAppWhenRun: Bool = false
    @Parameter(title: "便签") var noteKey: String
    @Parameter(title: "行") var line: Int
    @Parameter(title: "完成") var checked: Bool
    @Parameter(title: "原始待办") var expectedLine: String
    @Parameter(title: "原始快照", default: "") var expectedContent: String
    init() {}
    init(noteKey: String, line: Int, checked: Bool, expectedLine: String, expectedContent: String) { self.noteKey = noteKey; self.line = line; self.checked = checked; self.expectedLine = expectedLine; self.expectedContent = expectedContent }
    @MainActor func perform() async throws -> some IntentResult {
        guard let note = FolioWidgetStore.read().notes.first(where: { $0.key == noteKey }) else { return .result() }
        let lines = note.content.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n")
        // Archived views must not retarget a same-text task at the old line.
        // Old intents without a snapshot are safely rejected after upgrade.
        guard !expectedContent.isEmpty, note.content == expectedContent,
              lines.indices.contains(line), lines[line] == expectedLine else {
            WidgetCenter.shared.reloadTimelines(ofKind: "FolioNote")
            return .result()
        }
        try FolioWidgetStore.enqueueTask(FolioWidgetTaskChange(noteKey: noteKey, expectedContent: note.content, line: line, checked: checked))
        // Wake only the host belonging to this extension, without showing UI.
        let host = Bundle.main.bundleURL.deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        if let identifier = Bundle(url: host)?.bundleIdentifier,
           NSRunningApplication.runningApplications(withBundleIdentifier: identifier).isEmpty {
            let configuration = NSWorkspace.OpenConfiguration()
            configuration.activates = false
            configuration.arguments = ["--silent"]
            NSWorkspace.shared.openApplication(at: host, configuration: configuration) { _, _ in }
        }
        return .result()
    }
}
struct CopySharedNote: AppIntent {
    static var title: LocalizedStringResource = "复制便签 Markdown"
    static var openAppWhenRun: Bool = false
    @Parameter(title: "便签") var noteKey: String
    init() {}
    init(noteKey: String) { self.noteKey = noteKey }
    @MainActor func perform() async throws -> some IntentResult {
        guard let note = FolioWidgetStore.read().notes.first(where: { $0.key == noteKey }) else { return .result() }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(note.content, forType: .string)
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
        let spread = context.family == .systemExtraLarge
        let width = spread ? (context.displaySize.width - 48) / 2 : context.displaySize.width - 32
        let pages = WidgetMarkdown.pages(note.content, width: width, height: context.displaySize.height - 82, bodySize: configuration.textSize.points)
        let key = note.key + "." + String(context.family.rawValue) + "." + configuration.textSize.rawValue
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
                } else if let taskLine = line.taskLine {
                    Button(intent: ToggleNoteTask(noteKey: entry.note?.key ?? "", line: taskLine, checked: !line.taskChecked, expectedLine: line.sourceLine, expectedContent: entry.note?.content ?? "")) {
                        Text(line.text)
                            .font(.system(size: line.size))
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .frame(height: line.height, alignment: .topLeading)
                            .contentShape(Rectangle())
                    }.buttonStyle(.plain)
                        .accessibilityLabel(line.taskChecked ? "取消完成待办" : "完成待办")
                        .help("点击切换待办完成状态")
                } else {
                    Button(intent: CopyNoteText(noteKey: entry.note?.key ?? "", text: String(line.text.characters))) {
                      HStack(alignment: .top, spacing: 6) {
                        if line.quote { Rectangle().fill(.secondary).frame(width: 2) }
                        Text(line.text)
                            .font(.system(size: line.size, weight: line.heading ? .semibold : .regular, design: line.code ? .monospaced : .default))
                            .foregroundStyle(line.quote ? .secondary : .primary)
                            .frame(maxWidth: .infinity, alignment: .leading)
                      }.frame(height: line.height, alignment: .top)
                       .contentShape(Rectangle())
                    }.buttonStyle(.plain).accessibilityLabel("复制这一段文字").help("复制这一段文字")
                }
            }
        }.frame(maxWidth: .infinity, alignment: .topLeading)
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let note = entry.note {
              HStack(spacing: 8) {
                Button(intent: CopyNoteText(noteKey: note.key, text: note.title)) {
                    Text(note.title).font(.headline).lineLimit(1).widgetAccentable()
                        .frame(maxWidth: .infinity, alignment: .leading)
                }.buttonStyle(.plain).accessibilityLabel("复制便签标题").help("复制标题")
                if let url = note.link {
                  Link(destination: url) {
                    Image(systemName: "arrow.up.right.square").frame(width: 22, height: 22)
                  }.buttonStyle(.plain).accessibilityLabel("展开便签").help("展开便签")
                }
              }.layoutPriority(1)
            } else {
                Text("选择一张便签").font(.headline).lineLimit(1)
            }
            if entry.note != nil {
                HStack(alignment: .top, spacing: 16) {
                    page(entry.lines)
                    if entry.spread { page(entry.rightLines) }
                }.frame(maxHeight: .infinity, alignment: .topLeading).clipped()
            } else {
                Text("在笺影设置中选择便签，再编辑小组件。")
                    .font(.body).foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
            if entry.note != nil {
                HStack(spacing: 6) {
                  if entry.page > 0 {
                    Button(intent: TurnNotePage(key: entry.pageKey, page: 0)) { Image(systemName: "backward.end") }
                        .accessibilityLabel("回到第一页").help("回到第一页")
                  }
                  if entry.pageCount > 1 {
                    Button(intent: TurnNotePage(key: entry.pageKey, page: entry.page - step)) { Image(systemName: "chevron.left") }
                        .disabled(entry.page == 0).accessibilityLabel("上一页")
                    Spacer()
                    Text(pageLabel).font(.system(size: 10)).foregroundStyle(.secondary).lineLimit(1).minimumScaleFactor(0.8)
                    Spacer()
                    Button(intent: TurnNotePage(key: entry.pageKey, page: entry.page + step)) { Image(systemName: "chevron.right") }
                        .disabled(entry.page + step >= entry.pageCount).accessibilityLabel("下一页")
                  } else { Spacer() }
                  Button(intent: CopyNoteText(noteKey: entry.note?.key ?? "", text: visibleText)) { Image(systemName: "doc.on.doc") }
                    .disabled(visibleText.isEmpty).accessibilityLabel("复制当前页文字").help("复制当前页纯文本")
                  Button(intent: CopySharedNote(noteKey: entry.note?.key ?? "")) { Image(systemName: "doc.text") }
                    .accessibilityLabel("复制便签 Markdown 正文（共享内容最多四千字）").help("复制 Markdown 正文（共享内容最多4000字符）")
                }.buttonStyle(.plain).fixedSize(horizontal: false, vertical: true).layoutPriority(1)
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
        .configurationDisplayName(Bundle.main.bundleIdentifier == "dev.folio.surface.containerexperiment.widgets" ? "笺影便签 · 沙盒实验" : "笺影便签")
        .description("显示 Markdown 便签；点击段落复制文字，支持翻页和复制当前页。尺寸由系统管理。")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .systemExtraLarge])
    }
}
