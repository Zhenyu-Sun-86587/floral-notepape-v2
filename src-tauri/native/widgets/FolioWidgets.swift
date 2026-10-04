import AppIntents
import AppKit
import SwiftUI
import WidgetKit

enum NoteTextSize: String {
    case compact, standard, large
    var points: CGFloat { switch self { case .compact: return 12; case .standard: return 13; case .large: return 15 } }
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
    var slot: Int = 1
}
struct TurnNotePage: AppIntent {
    static var title: LocalizedStringResource = "翻阅便签"
    static var openAppWhenRun: Bool = false
    @Parameter(title: "便签页面") var key: String
    @Parameter(title: "页码") var page: Int
    init() {}
    init(key: String, page: Int) { self.key = key; self.page = page }
    func perform() async throws -> some IntentResult {
        let parts = key.split(separator: ".")
        guard parts.count == 4, parts[0].hasPrefix("slot"),
              let slot = Int(parts[0].dropFirst(4)),
              FolioWidgetStore.read().isDisplayed(key: String(parts[1]), slot: slot) else { return .result() }
        FolioWidgetStore.setPage(page, for: key)
        WidgetCenter.shared.reloadTimelines(ofKind: FolioWidgetStore.widgetKinds[slot - 1])
        return .result()
    }
}
struct CopyNoteText: AppIntent {
    static var title: LocalizedStringResource = "复制便签文字"
    static var openAppWhenRun: Bool = false
    @Parameter(title: "便签") var noteKey: String
    @Parameter(title: "文字") var text: String
    @Parameter(title: "小组件编号", default: 0) var slot: Int
    init() {}
    init(noteKey: String, text: String, slot: Int) { self.noteKey = noteKey; self.text = text; self.slot = slot }
    @MainActor func perform() async throws -> some IntentResult {
        // Removed sharing permission must also invalidate a cached copy button.
        guard FolioWidgetStore.read().isDisplayed(key: noteKey, slot: slot), !text.isEmpty else { return .result() }
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
    @Parameter(title: "小组件编号", default: 0) var slot: Int
    init() {}
    init(noteKey: String, line: Int, checked: Bool, expectedLine: String, expectedContent: String, slot: Int) { self.noteKey = noteKey; self.line = line; self.checked = checked; self.expectedLine = expectedLine; self.expectedContent = expectedContent; self.slot = slot }
    @MainActor func perform() async throws -> some IntentResult {
        let snapshot = FolioWidgetStore.read()
        guard snapshot.isDisplayed(key: noteKey, slot: slot), let note = snapshot.selectedNote(key: noteKey) else { return .result() }
        let lines = note.content.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n")
        // Archived views must not retarget a same-text task at the old line.
        // Old intents without a snapshot are safely rejected after upgrade.
        guard !expectedContent.isEmpty, note.content == expectedContent,
              lines.indices.contains(line), lines[line] == expectedLine else {
            WidgetCenter.shared.reloadTimelines(ofKind: FolioWidgetStore.widgetKinds[slot - 1])
            return .result()
        }
        try FolioWidgetStore.enqueueTask(FolioWidgetTaskChange(noteKey: noteKey, expectedContent: note.content, line: line, checked: checked, slot: slot))
        try await wakeFolioHost()
        return .result()
    }
}

// Use the same primitive-parameter background intent route as task buttons.
// A Link activates the containing application and triggers its Reopen handler.
struct OpenNoteWindow: AppIntent {
    static var title: LocalizedStringResource = "展开便签"
    static var openAppWhenRun: Bool = false
    @Parameter(title: "便签") var noteKey: String
    @Parameter(title: "小组件编号", default: 0) var slot: Int
    init() {}
    init(noteKey: String, slot: Int) { self.noteKey = noteKey; self.slot = slot }
    @MainActor func perform() async throws -> some IntentResult {
        guard FolioWidgetStore.read().isDisplayed(key: noteKey, slot: slot) else { return .result() }
        try FolioWidgetStore.enqueueAction(FolioWidgetOpenRequest(noteKey: noteKey, slot: slot))
        try await wakeFolioHost()
        return .result()
    }
}

@MainActor private func wakeFolioHost() async throws {
        // Wake only the host belonging to this extension, without showing UI.
        let host = Bundle.main.bundleURL.deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
        if let identifier = Bundle(url: host)?.bundleIdentifier,
           NSRunningApplication.runningApplications(withBundleIdentifier: identifier).isEmpty {
            let configuration = NSWorkspace.OpenConfiguration()
            configuration.activates = false
            configuration.addsToRecentItems = false
            configuration.arguments = ["--silent"]
            _ = try await NSWorkspace.shared.openApplication(at: host, configuration: configuration)
        }
}
struct CopySharedNote: AppIntent {
    static var title: LocalizedStringResource = "复制便签 Markdown"
    static var openAppWhenRun: Bool = false
    @Parameter(title: "便签") var noteKey: String
    @Parameter(title: "小组件编号", default: 0) var slot: Int
    init() {}
    init(noteKey: String, slot: Int) { self.noteKey = noteKey; self.slot = slot }
    @MainActor func perform() async throws -> some IntentResult {
        let snapshot = FolioWidgetStore.read()
        guard snapshot.isDisplayed(key: noteKey, slot: slot), let note = snapshot.selectedNote(key: noteKey) else { return .result() }
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(note.content, forType: .string)
        return .result()
    }
}
struct NoteProvider: TimelineProvider {
    let slot: Int
    func placeholder(in context: Context) -> NoteEntry {
        NoteEntry(date: .now, note: FolioWidgetNote(key: "", title: "笺影", content: "记录此刻，留待回望。"))
    }
    func getSnapshot(in context: Context, completion: @escaping (NoteEntry) -> Void) {
        completion(entry(context: context))
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<NoteEntry>) -> Void) {
        // Host publishes only on changes; no polling, capture, or animation timer.
        completion(Timeline(entries: [entry(context: context)], policy: .never))
    }
    private func entry(context: Context) -> NoteEntry {
        let snapshot = FolioWidgetStore.read()
        let display = snapshot.display(slot: slot)
        let note = snapshot.selectedNote(key: display?.noteKey)
        FolioWidgetStore.experimentLog.notice("WIDGET_DISPLAY slot=\(slot) assigned=\(display?.noteKey != nil) resolved=\(note != nil)")
        guard let note else { return NoteEntry(date: .now, note: nil, slot: slot) }
        let textSize = NoteTextSize(rawValue: display?.textSize ?? "") ?? .standard
        let spread = context.family == .systemExtraLarge
        let width = spread ? (context.displaySize.width - 48) / 2 : context.displaySize.width - 32
        let pages = WidgetMarkdown.pages(note.content, width: width, height: context.displaySize.height - 82, bodySize: textSize.points)
        let key = "slot\(slot)." + note.key + "." + String(context.family.rawValue) + "." + textSize.rawValue
        let step = spread ? 2 : 1
        let page = min(FolioWidgetStore.page(for: key), pages.count - 1) / step * step
        return NoteEntry(date: .now, note: note, lines: pages[page], rightLines: spread && page + 1 < pages.count ? pages[page + 1] : [], spread: spread, page: page, pageCount: pages.count, pageKey: key, slot: slot)
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
                    Button(intent: ToggleNoteTask(noteKey: entry.note?.key ?? "", line: taskLine, checked: !line.taskChecked, expectedLine: line.sourceLine, expectedContent: entry.note?.content ?? "", slot: entry.slot)) {
                        Text(line.text)
                            .font(.system(size: line.size))
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .frame(height: line.height, alignment: .topLeading)
                            .contentShape(Rectangle())
                    }.buttonStyle(.plain)
                        .accessibilityLabel(line.taskChecked ? "取消完成待办" : "完成待办")
                        .help("点击切换待办完成状态")
                } else {
                    Button(intent: CopyNoteText(noteKey: entry.note?.key ?? "", text: String(line.text.characters), slot: entry.slot)) {
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
                Button(intent: CopyNoteText(noteKey: note.key, text: note.title, slot: entry.slot)) {
                    Text(note.title).font(.headline).lineLimit(1).widgetAccentable()
                        .frame(maxWidth: .infinity, alignment: .leading)
                }.buttonStyle(.plain).accessibilityLabel("复制便签标题").help("复制标题")
                if note.link != nil {
                  Button(intent: OpenNoteWindow(noteKey: note.key, slot: entry.slot)) {
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
                Text("在笺影主应用设置中，为便签 \(entry.slot) 选择内容并允许共享。")
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
                  Button(intent: CopyNoteText(noteKey: entry.note?.key ?? "", text: visibleText, slot: entry.slot)) { Image(systemName: "doc.on.doc") }
                    .disabled(visibleText.isEmpty).accessibilityLabel("复制当前页文字").help("复制当前页纯文本")
                  Button(intent: CopySharedNote(noteKey: entry.note?.key ?? "", slot: entry.slot)) { Image(systemName: "doc.text") }
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
struct FolioNoteWidget: Widget {
    let slot: Int
    init() { self.slot = 1 }
    init(slot: Int) { self.slot = slot }
    private var displayName: LocalizedStringKey {
        // WidgetKit rejects formatted/interpolated configuration labels at runtime.
        switch slot {
        case 2: return "笺影便签 2"
        case 3: return "笺影便签 3"
        case 4: return "笺影便签 4"
        default: return "笺影便签 1"
        }
    }
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: slot == 1 ? "FolioNote" : "FolioNote\(slot)", provider: NoteProvider(slot: slot)) { entry in
            NoteWidgetView(entry: entry)
        }
        .configurationDisplayName(displayName)
        .description("显示 Markdown 便签；点击段落复制文字，支持翻页和复制当前页。尺寸由系统管理。")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge, .systemExtraLarge])
    }
}
@main
struct FolioWidgets: WidgetBundle {
    var body: some Widget {
        FolioNoteWidget(slot: 1)
        FolioNoteWidget(slot: 2)
        FolioNoteWidget(slot: 3)
        FolioNoteWidget(slot: 4)
    }
}
