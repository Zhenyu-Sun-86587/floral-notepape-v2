// Run with: xcrun swift src-tauri/native/tests/NoteLayout.swift
// Real AppKit/WKWebView regression for the note body/title layout contract.
import AppKit
import WebKit

let app = NSApplication.shared
let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 400, height: 300), styleMask: [.borderless], backing: .buffered, defer: false)
let root = NSView(frame: window.contentView!.bounds)
window.contentView = root
let body = WKWebView(frame: root.bounds)
root.addSubview(body)
body.translatesAutoresizingMaskIntoConstraints = false
NSLayoutConstraint.activate([
    body.leadingAnchor.constraint(equalTo: root.leadingAnchor),
    body.trailingAnchor.constraint(equalTo: root.trailingAnchor),
    body.topAnchor.constraint(equalTo: root.topAnchor, constant: 48),
    body.bottomAnchor.constraint(equalTo: root.bottomAnchor)
])
for size in [NSSize(width: 400, height: 300), NSSize(width: 360, height: 220), NSSize(width: 640, height: 480)] {
    root.setFrameSize(size)
    body.frame = root.bounds // Simulate Wry's later full-window resize.
    root.needsLayout = true
    root.layoutSubtreeIfNeeded()
    precondition(abs(body.frame.maxY - (size.height - 48)) < 0.01, "Title/body overlap: \(body.frame)")
    precondition(abs(body.frame.height - (size.height - 48)) < 0.01)
}
print("Native title/body constraints survive full-window frame updates at 3 sizes")
