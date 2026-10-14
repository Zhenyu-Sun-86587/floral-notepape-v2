import AppKit

// Hidden synthetic windows only: no application notes, preferences or UI tests.
// AppKit's bottom-left resize anchor makes position-then-size drift, whereas
// size-then-position must preserve the saved top-left through repeated reopen.
@main
struct WindowBoundsRegression {
    static func window(_ height: CGFloat) -> NSWindow {
        let window = NSWindow(
            contentRect: NSRect(x: 120, y: 240, width: 420, height: height),
            styleMask: [.borderless], backing: .buffered, defer: false)
        window.isReleasedWhenClosed = false
        return window
    }
    static func main() {
        let target = NSPoint(x: 200, y: 800)
        let legacy = window(260)
        legacy.setFrameTopLeftPoint(target)
        legacy.setContentSize(NSSize(width: 420, height: 500))
        let legacyTop = NSPoint(x: legacy.frame.minX, y: legacy.frame.maxY)
        precondition(abs(legacyTop.y - target.y) > 1, "Old order must reproduce drift")
        legacy.close()
        var saved = target
        for height in [CGFloat(220), 500, 760, 320, 640] {
            for _ in 0..<10 {
                let restored = window(260)
                restored.setContentSize(NSSize(width: 420, height: height))
                restored.setFrameTopLeftPoint(saved)
                saved = NSPoint(x: restored.frame.minX, y: restored.frame.maxY)
                precondition(abs(saved.x - target.x) < 0.01 && abs(saved.y - target.y) < 0.01,
                             "Reopen must not accumulate position drift")
                restored.close()
            }
        }
        print("AppKit window bounds: old-order drift reproduced; 50 restores preserve top-left")
        // Match the native note hierarchy: a full-window clip holds a retained
        // Tao/Wry view whose frame excludes the 48-point AppKit header. Saving
        // that view size as the window size shrinks each subsequent restore.
        let legacyNote = window(640)
        let clip = NSView(frame: NSRect(x: 0, y: 0, width: 420, height: 640))
        legacyNote.contentView = clip
        let body = NSView(frame: NSRect(x: 0, y: 0, width: 420, height: 592))
        clip.addSubview(body)
        legacyNote.setContentSize(body.frame.size)
        precondition(abs(legacyNote.frame.height - 592) < 0.01,
                     "Persisting the inset view must reproduce 48-point shrink")
        legacyNote.close()
        for height in [CGFloat(260), 500, 760, 640] {
            var savedSize = NSSize(width: 420, height: height)
            for _ in 0..<15 {
                let note = window(260)
                note.setContentSize(savedSize)
                note.setFrameTopLeftPoint(target)
                let size = note.frame.size
                let clip = NSView(frame: NSRect(origin: .zero, size: size))
                note.contentView = clip
                clip.addSubview(NSView(frame: NSRect(x: 0, y: 0, width: size.width,
                                                     height: size.height - 48)))
                savedSize = note.frame.size
                precondition(abs(savedSize.width - 420) < 0.01 &&
                             abs(savedSize.height - height) < 0.01 &&
                             abs(note.frame.maxY - target.y) < 0.01,
                             "Native title must not shrink persisted note height")
                note.close()
            }
        }
        print("AppKit note height: 48-point shrink reproduced; 60 restores preserve full size and position")
    }
}
