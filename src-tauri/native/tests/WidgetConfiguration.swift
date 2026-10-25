import WidgetKit

@main
enum WidgetConfigurationCheck {
    static func main() {
        // Construction executes WidgetKit's configuration text validation.
        // Compilation alone does not reject formatted gallery labels.
        for slot in 1...4 {
            _ = FolioNoteWidget(slot: slot).body
        }
        let families = FolioNoteWidget.supportedFamilies
        precondition(families.contains(.systemExtraLarge))
        if #available(macOS 27.0, *) {
            precondition(families.contains(.systemExtraLargePortrait))
            precondition(WidgetFamily.systemExtraLargePortrait.rawValue != WidgetFamily.systemExtraLarge.rawValue,
                         "Portrait and landscape must keep independent pagination keys")
        }
        print("All four WidgetKit configurations constructed")
    }
}
