import Foundation
import Darwin

@main
struct WidgetBridgeRegression {
    static func main() throws {
        // macOS 27 may report the denial directly or wrapped by Foundation.
        for error in [
            NSError(domain: NSPOSIXErrorDomain, code: Int(EPERM)),
            NSError(domain: NSPOSIXErrorDomain, code: Int(EACCES)),
            NSError(domain: NSCocoaErrorDomain, code: 257),
            NSError(domain: NSCocoaErrorDomain, code: 513),
            NSError(domain: NSCocoaErrorDomain, code: 256, userInfo: [NSUnderlyingErrorKey: NSError(domain: NSPOSIXErrorDomain, code: Int(EPERM))])
        ] {
            precondition(FolioWidgetBridgeDiagnostics.isPermissionError(error))
            FolioWidgetBridgeDiagnostics.failure("snapshot", error)
            let status = try JSONSerialization.jsonObject(with: FolioWidgetBridgeDiagnostics.json()) as! [String: Any]
            precondition(status["snapshot"] as? String == "denied")
        }
        precondition(!FolioWidgetBridgeDiagnostics.isPermissionError(CocoaError(.fileNoSuchFile)))
        FolioWidgetBridgeDiagnostics.success("snapshot")
        let recovered = try JSONSerialization.jsonObject(with: FolioWidgetBridgeDiagnostics.json()) as! [String: Any]
        precondition(recovered["snapshot"] as? String == "ready")
        precondition((recovered["errors"] as? [String: String])?.isEmpty == true)
        var output = [CChar](repeating: 0, count: 2048)
        output.withUnsafeMutableBufferPointer { folioWidgetsBridgeStatus($0.baseAddress!, Int32($0.count)) }
        let json = output.withUnsafeBufferPointer { String(cString: $0.baseAddress!) }
        let decoded = try JSONSerialization.jsonObject(with: Data(json.utf8))
        precondition(decoded is [String: Any])
        print("Widget bridge: permission failures distinguished from missing files; recovery and FFI status passed")
    }
}
