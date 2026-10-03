// An isolated configuration transport probe, excluded from production targets.
// Deliberately has no App Intents buttons or writes to user data.
import Intents
import SwiftUI
import WidgetKit

struct LegacyProbeEntry: TimelineEntry {
    let date: Date
    let note: FolioWidgetNote?
}

struct LegacyProbeProvider: IntentTimelineProvider {
    func placeholder(in context: Context) -> LegacyProbeEntry {
        LegacyProbeEntry(date: .now, note: nil)
    }
    func getSnapshot(for configuration: FolioLegacySelectionIntent, in context: Context,
                     completion: @escaping (LegacyProbeEntry) -> Void) {
        completion(entry(configuration))
    }
    func getTimeline(for configuration: FolioLegacySelectionIntent, in context: Context,
                     completion: @escaping (Timeline<LegacyProbeEntry>) -> Void) {
        completion(Timeline(entries: [entry(configuration)], policy: .never))
    }
    private func entry(_ configuration: FolioLegacySelectionIntent) -> LegacyProbeEntry {
        let notes = FolioWidgetStore.read().notes
        let selected = configuration.noteName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let matches = notes.filter { !selected.isEmpty && ($0.key == selected || $0.title == selected) }
        // Duplicate titles never select an arbitrary note; an exact key works.
        let note = matches.count == 1 ? matches[0] : nil
        FolioWidgetStore.experimentLog.notice("LEGACY_CONFIG nonempty=\(!selected.isEmpty) matches=\(matches.count) resolvedIndex=\(note.flatMap { note in notes.firstIndex { $0.key == note.key } } ?? -1)")
        return LegacyProbeEntry(date: .now, note: note)
    }
}

@main
struct LegacyWidgetProbe: Widget {
    var body: some WidgetConfiguration {
        IntentConfiguration(kind: "FolioNoteLegacyProbe", intent: FolioLegacySelectionIntent.self,
                            provider: LegacyProbeProvider()) { entry in
            VStack(alignment: .leading, spacing: 8) {
                Text(entry.note?.title ?? "配置验证").font(.headline)
                Text(entry.note?.content ?? "编辑小组件，输入已共享的便签名称或标识。")
                    .font(.body).frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            }.containerBackground(.background, for: .widget)
        }
        .configurationDisplayName("笺影 · 免费配置验证")
        .description("仅验证系统是否能传递笔记选择，不包含交互。")
        .supportedFamilies([.systemMedium, .systemLarge])
    }
}
