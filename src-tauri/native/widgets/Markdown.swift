import AppKit
import Foundation

// Small, bounded native renderer: no web view, network, or layout timer.
struct WidgetMarkdownLine: Identifiable {
    let id: Int
    let text: AttributedString
    let size: CGFloat
    let heading: Bool
    let code: Bool
    let quote: Bool
    let rule: Bool
    let height: CGFloat
    var taskLine: Int? = nil
    var taskChecked: Bool = false
    var sourceLine: String = ""
}

enum WidgetMarkdown {
    private struct LayoutKey: Hashable {
        let content: String
        let width: CGFloat
        let height: CGFloat
        let bodySize: CGFloat
    }
    private static let layoutLock = NSLock()
    private static var layouts: [(key: LayoutKey, pages: [[WidgetMarkdownLine]])] = []
    static func pages(_ content: String, width: CGFloat, height: CGFloat, bodySize: CGFloat = 13) -> [[WidgetMarkdownLine]] {
        let key = LayoutKey(content: String(content.prefix(4000)), width: max(60, width), height: max(24, height), bodySize: bodySize)
        layoutLock.lock()
        if let index = layouts.firstIndex(where: { $0.key == key }) {
            let hit = layouts.remove(at: index)
            layouts.append(hit)
            layoutLock.unlock()
            return hit.pages
        }
        layoutLock.unlock()
        let pages = renderPages(key.content, width: key.width, height: key.height, bodySize: key.bodySize)
        layoutLock.lock()
        layouts.removeAll { $0.key == key }
        layouts.append((key, pages))
        if layouts.count > 4 { layouts.removeFirst(layouts.count - 4) }
        layoutLock.unlock()
        return pages
    }
    private static func renderPages(_ content: String, width: CGFloat, height: CGFloat, bodySize: CGFloat) -> [[WidgetMarkdownLine]] {
        let width = max(60, width)
        let height = max(24, height)
        var pages: [[WidgetMarkdownLine]] = [[]]
        var used: CGFloat = 0
        var fenced = false
        var nextID = 0
        for (lineIndex, raw) in content.prefix(4000).replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n").enumerated() {
            var line = raw.trimmingCharacters(in: .whitespaces)
            if line.hasPrefix("```") || line.hasPrefix("~~~") { fenced.toggle(); continue }
            let headingPrefix = line.prefix(while: { $0 == "#" }).count
            let heading = !fenced && (1...6).contains(headingPrefix) && line.dropFirst(headingPrefix).hasPrefix(" ")
            let quote = !fenced && line.hasPrefix(">")
            let rule = !fenced && ["---", "***", "___"].contains(line)
            let task = !fenced && !quote && ["- [ ] ", "- [x] ", "- [X] ", "* [ ] ", "* [x] ", "* [X] ", "+ [ ] ", "+ [x] ", "+ [X] "].contains(where: { line.hasPrefix($0) })
            let taskChecked = task && !line.hasPrefix("- [ ] ") && !line.hasPrefix("* [ ] ") && !line.hasPrefix("+ [ ] ")
            if heading { line = String(line.dropFirst(headingPrefix + 1)) }
            if quote { line = String(line.dropFirst()).trimmingCharacters(in: .whitespaces) }
            if !fenced {
                for (prefix, marker) in [("- [x] ", "☑ "), ("- [X] ", "☑ "), ("- [ ] ", "☐ "), ("* [x] ", "☑ "), ("* [ ] ", "☐ "), ("- ", "• "), ("* ", "• "), ("+ ", "• ")] {
                    if line.hasPrefix(prefix) { line = marker + line.dropFirst(prefix.count); break }
                }
            }
            let size: CGFloat = heading ? bodySize + 2 : bodySize
            let font: NSFont = fenced ? .monospacedSystemFont(ofSize: size, weight: .regular) : .systemFont(ofSize: size, weight: heading ? .semibold : .regular)
            let attributed = fenced ? AttributedString(line) : ((try? AttributedString(markdown: line, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace))) ?? AttributedString(line))
            // Split at rendered character boundaries so a single long paragraph
            // remains reachable instead of being truncated on the first page.
            let characters = Array(attributed.characters)
            var start = 0
            repeat {
                func measure(_ end: Int) -> CGFloat {
                    let candidate = String(characters[start..<end])
                    let rect = (candidate as NSString).boundingRect(with: NSSize(width: (width - (quote ? 10 : 0)) * 0.95, height: .greatestFiniteMagnitude), options: [.usesLineFragmentOrigin, .usesFontLeading], attributes: [.font: font])
                    return ceil(rect.height)
                }
                var low = min(start + 1, characters.count)
                var high = characters.count
                while low < high {
                    let mid = (low + high + 1) / 2
                    if measure(mid) <= min(height - 4, size * 3.8) { low = mid } else { high = mid - 1 }
                }
                let end = low
                let measured = measure(end)
                let lower = attributed.characters.index(attributed.startIndex, offsetBy: start)
                let upper = attributed.characters.index(attributed.startIndex, offsetBy: end)
                let fragment = AttributedString(attributed[lower..<upper])
                let itemHeight = rule ? 8 : max(size + 3, measured + 4)
                if used + itemHeight > height, !pages[pages.count - 1].isEmpty { pages.append([]); used = 0 }
                pages[pages.count - 1].append(WidgetMarkdownLine(id: nextID, text: fragment, size: size, heading: heading, code: fenced, quote: quote, rule: rule, height: itemHeight, taskLine: task ? lineIndex : nil, taskChecked: taskChecked, sourceLine: task ? raw : ""))
                nextID += 1
                used += itemHeight
                start = end
            } while start < characters.count
        }
        return pages
    }
}
