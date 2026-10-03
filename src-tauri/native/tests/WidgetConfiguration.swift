import WidgetKit

@main
enum WidgetConfigurationCheck {
    static func main() {
        // Construction executes WidgetKit's configuration text validation.
        // Compilation alone does not reject formatted gallery labels.
        for slot in 1...4 {
            _ = FolioNoteWidget(slot: slot).body
        }
        print("All four WidgetKit configurations constructed")
    }
}
