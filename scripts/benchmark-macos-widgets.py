"""Compare native WidgetKit snapshot/layout hot paths against a Git revision.

Uses synthetic notes only and the local command-line Swift compiler. This is a
warm-process microbenchmark, not a measurement of WidgetKit's system rendering.
"""
import argparse
import json
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent.parent
HARNESS = r'''
import AppKit
import Foundation

#if !OPTIMIZED
extension FolioWidgetStore {
    static func readSnapshot(at url: URL) -> FolioWidgetSnapshot {
        guard let bytes = try? Data(contentsOf: url), bytes.count <= 1_048_576,
              let snapshot = try? JSONDecoder().decode(FolioWidgetSnapshot.self, from: bytes) else { return .empty }
        return snapshot
    }
}
#endif

func timed(_ count: Int, _ work: () -> Void) -> Double {
    let start = DispatchTime.now().uptimeNanoseconds
    for _ in 0..<count { work() }
    return Double(DispatchTime.now().uptimeNanoseconds - start) / Double(count) / 1_000_000
}
let directory = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
let snapshotURL = directory.appendingPathComponent("notes.json")
let content = "# 测试便签\n> 引用与 **粗体**\n- [ ] 可交互待办\n" + String(repeating: "这是一段用于分页性能对比的测试正文，包含中文与 English。\n", count: 100)
let bounded = String(content.prefix(4000))
let notes = (0..<32).map { FolioWidgetNote(key: "note:\($0)", title: "测试\($0)", content: bounded) }
try JSONEncoder().encode(FolioWidgetSnapshot(notes: notes)).write(to: snapshotURL, options: .atomic)
precondition(FolioWidgetStore.readSnapshot(at: snapshotURL).notes.count == 32)
let readMS = timed(500) { precondition(FolioWidgetStore.readSnapshot(at: snapshotURL).notes.count == 32) }
let coldMS = timed(1) { _ = WidgetMarkdown.pages(bounded, width: 300, height: 270) }
let expected = WidgetMarkdown.pages(bounded, width: 300, height: 270)
let layoutMS = timed(50) { precondition(WidgetMarkdown.pages(bounded, width: 300, height: 270).count == expected.count) }
let signature = expected.map { $0.map { "\(String($0.text.characters))|\($0.height)" }.joined(separator: "\n") }.joined(separator: "\nPAGE\n")
#if OPTIMIZED
let changed = FolioWidgetSnapshot(notes: [FolioWidgetNote(key: "note:changed", title: "Changed", content: bounded)])
try JSONEncoder().encode(changed).write(to: snapshotURL, options: .atomic)
precondition(FolioWidgetStore.readSnapshot(at: snapshotURL).notes.first?.key == "note:changed")
try Data("invalid".utf8).write(to: snapshotURL, options: .atomic)
precondition(FolioWidgetStore.readSnapshot(at: snapshotURL).notes.isEmpty)
try FileManager.default.removeItem(at: snapshotURL)
precondition(FolioWidgetStore.readSnapshot(at: snapshotURL).notes.isEmpty)
try JSONEncoder().encode(changed).write(to: snapshotURL, options: .atomic)
precondition(FolioWidgetStore.readSnapshot(at: snapshotURL).notes.count == 1)
let tasks = WidgetMarkdown.pages("- [ ] 待办\r\n```\r\n- [ ] 示例\r\n```\r\n- [x] 完成", width: 300, height: 270).flatMap { $0 }.filter { $0.taskLine != nil }
precondition(tasks.count == 2 && tasks[0].taskLine == 0 && tasks[1].taskLine == 4 && tasks[1].taskChecked)
// Exercise eviction and ensure layout identity includes content and dimensions.
for n in 0..<8 { _ = WidgetMarkdown.pages("# \(n)\n" + bounded, width: CGFloat(200 + n), height: 270) }
precondition(WidgetMarkdown.pages(bounded, width: 300, height: 270).count == expected.count)
#endif
let result: [String: Any] = ["read_ms": readMS, "cold_layout_ms": coldMS, "warm_layout_ms": layoutMS, "page_count": expected.count, "signature": signature]
print(String(data: try JSONSerialization.data(withJSONObject: result), encoding: .utf8)!)
'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--baseline', default='16f1e88')
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    results = {}
    signatures = []
    with tempfile.TemporaryDirectory(prefix='folio-widget-benchmark-') as temporary:
        for mode in ['before', 'after']:
            directory = Path(temporary) / mode
            directory.mkdir()
            files = []
            for name in ['Shared.swift', 'Markdown.swift']:
                relative = 'src-tauri/native/widgets/' + name
                source = subprocess.check_output(['git', 'show', f'{args.baseline}:{relative}'], cwd=ROOT, text=True) if mode == 'before' else (ROOT / relative).read_text()
                path = directory / name
                path.write_text(source)
                files.append(str(path))
            harness = directory / 'main.swift'
            harness.write_text(HARNESS)
            binary = directory / 'benchmark'
            command = ['swiftc', '-O', '-framework', 'AppKit', *files, str(harness), '-o', str(binary)]
            if mode == 'after':
                command += ['-D', 'OPTIMIZED']
            subprocess.run(command, check=True)
            samples = [json.loads(subprocess.check_output([str(binary), str(directory)], text=True)) for _ in range(3)]
            signatures.append(samples[0].pop('signature'))
            results[mode] = {key: sorted(sample[key] for sample in samples)[1] for key in samples[0] if key != 'signature'}
    assert signatures[0] == signatures[1], 'Pagination or Markdown output changed.'
    results['identical_rendering'] = True
    results['baseline'] = args.baseline
    results['scope'] = '32 synthetic notes; median of 3 warm-process samples; native hot paths only'
    result = json.dumps(results, indent=2) + '\n'
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(result)
    print(result)


if __name__ == '__main__':
    main()
