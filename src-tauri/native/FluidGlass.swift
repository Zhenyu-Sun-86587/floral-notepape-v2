// macOS-only, in-memory ScreenCaptureKit -> Metal background refraction.
import AppKit
import ScreenCaptureKit
import MetalKit
import CoreVideo

private let shader = #"""
#include <metal_stdlib>
using namespace metal;
struct V { float4 position [[position]]; float2 uv; };
vertex V fluidVertex(uint i [[vertex_id]]) {
    float2 p[3]={float2(-1,-1),float2(3,-1),float2(-1,3)};
    return {float4(p[i],0,1),float2((p[i].x+1)*.5,1-(p[i].y+1)*.5)};
}
float shape(float2 p,constant float4 *u) {
    if(u[2].z>0.5) {
        float r=min(u[2].w,min(u[0].x,u[0].y)*.5);
        float inset=max(0.,u[2].y-1.)*min(u[0].x,u[0].y)*.15;
        float2 q=abs(p-u[0].xy*.5)-u[0].xy*.5+r+inset;
        return length(max(q,0.))+min(max(q.x,q.y),0.)-r;
    }
    float d=10000;
    for(uint i=0;i<uint(u[2].x);i++) {
        float4 c=u[3+i];
        float2 delta=p-c.xy;
        delta.y/=u[2].y;
        delta.x*=u[2].y;
        float b=length(delta)-c.z;
        float k=14;
        float h=clamp(.5+.5*(b-d)/k,0.,1.);
        d=mix(b,d,h)-k*h*(1-h);
    }
    return d;
}
fragment float4 fluidFragment(V in [[stage_in]],constant float4 *u [[buffer(0)]],
                              texture2d<float> desktop [[texture(0)]]) {
    constexpr sampler s(coord::normalized,address::clamp_to_edge,filter::linear);
    float2 p=in.uv*u[0].xy;
    float d=shape(p,u);
    float a=1-smoothstep(-.65,.65,d);
    if(a<.001) return float4(0);
    float2 n=float2(shape(p+float2(.6,0),u)-shape(p-float2(.6,0),u),
                    shape(p+float2(0,.6),u)-shape(p-float2(0,.6),u));
    n=normalize(n+float2(.0001));
    float t=clamp(1+d/22.,0.,1.);
    bool note=u[2].z>0.5;
    float lens=pow(t,2.2)*(note ? 7. : 16.)*u[1].w;
    float2 uv=(u[0].zw+p-n*lens)/u[1].xy;
    float3 col=desktop.sample(s,uv).rgb;
    if(note) {
        float2 step=1.5/u[1].xy;
        col=(col*2+desktop.sample(s,uv+float2(step.x,0)).rgb+
             desktop.sample(s,uv-float2(step.x,0)).rgb+
             desktop.sample(s,uv+float2(0,step.y)).rgb+
             desktop.sample(s,uv-float2(0,step.y)).rgb)/6.;
    }
    // Low tint, directional rim light, no solid border.
    col=mix(col,float3(.92,.97,1),note ? .08+u[1].z*.35 : .025+u[1].z*.08);
    float rim=exp(-abs(d)*.65);
    float light=pow(max(0.,dot(n,normalize(float2(-.6,-.8)))),3.);
    col+=rim*(light*.22-.025);
    return float4(clamp(col,0.,1.)*a,a);
}
"""#

private final class Capture: NSObject, SCStreamOutput, SCStreamDelegate {
    let display: SCDisplay
    var stream: SCStream?
    var texture: CVMetalTexture?
    var pixel: CVPixelBuffer?
    var cache: CVMetalTextureCache?
    var active = true
    var configuration: SCStreamConfiguration?
    var fps = 24
    func rate(_ value:Int) {
        guard value != fps, let configuration, active else { return }
        fps = value
        configuration.minimumFrameInterval = CMTime(value:1,timescale:Int32(value))
        stream?.updateConfiguration(configuration) { _ in }
    }
    init(display: SCDisplay, content: SCShareableContent) throws {
        self.display = display
        super.init()
        guard let device = Fluid.device else { throw NSError(domain:"Metal unavailable",code:1) }
        CVMetalTextureCacheCreate(nil,nil,device,nil,&cache)
        let own = content.applications.filter { $0.processID == getpid() }
        guard !own.isEmpty else { throw NSError(domain:"Cannot exclude app",code:2) }
        let filter = SCContentFilter(display:display,excludingApplications:own,exceptingWindows:[])
        let config = SCStreamConfiguration()
        let ratio = min(1,1600.0/Double(display.width))
        config.width = max(1,Int(Double(display.width)*ratio))
        config.height = max(1,Int(Double(display.height)*ratio))
        fps = Fluid.views.values.contains { $0.displayID == display.displayID && !$0.isNote } ? Fluid.capsuleFPS : Fluid.noteFPS
        config.minimumFrameInterval = CMTime(value:1,timescale:Int32(fps))
        configuration = config
        config.queueDepth = 3
        config.pixelFormat = kCVPixelFormatType_32BGRA
        config.showsCursor = false
        config.capturesAudio = false
        config.captureMicrophone = false
        config.colorSpaceName = CGColorSpace.sRGB
        let stream = SCStream(filter:filter,configuration:config,delegate:self)
        self.stream = stream
        try stream.addStreamOutput(self,type:.screen,sampleHandlerQueue:.main)
        stream.startCapture { error in
            if let error { DispatchQueue.main.async { self.fail(error) } }
        }
    }
    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard active, type == .screen, sampleBuffer.isValid,
              let attachments = CMSampleBufferGetSampleAttachmentsArray(sampleBuffer,createIfNecessary:false) as? [[SCStreamFrameInfo:Any]],
              let raw = attachments.first?[.status] as? Int,
              SCFrameStatus(rawValue:raw) == .complete,
              let image = CMSampleBufferGetImageBuffer(sampleBuffer), let cache else { return }
        var next: CVMetalTexture?
        let result = CVMetalTextureCacheCreateTextureFromImage(nil,cache,image,nil,.bgra8Unorm,
            CVPixelBufferGetWidth(image),CVPixelBufferGetHeight(image),0,&next)
        guard result == kCVReturnSuccess, let next else { return }
        pixel = image
        texture = next
        for view in Fluid.views.values where view.displayID == display.displayID && view.renderable {
            if view.isPaused { view.draw() }
        }
    }
    func stream(_ stream: SCStream, didStopWithError error: Error) { DispatchQueue.main.async { self.fail(error) } }
    func fail(_ error: Error) {
        guard active else { return }
        stop()
        Fluid.status = "采样失败，已回退到弹性玻璃"
        Fluid.retryAfter = ProcessInfo.processInfo.systemUptime+15
        NSLog("Fluid capture: %@",String(describing:error))
        for view in Fluid.views.values where view.displayID == display.displayID { view.fallback() }
    }
    func stop() {
        active = false
        stream?.stopCapture { _ in }
        stream = nil
        texture = nil
        pixel = nil
    }
}

private final class FluidView: MTKView, MTKViewDelegate {
    weak var backing: NSView?
    var displayID: CGDirectDisplayID = 0
    var cells: [SIMD4<Float>] = []
    var concentration: Float = 0
    var pressed = false
    var pressStart = 0.0
    var fromScale: Float = 1
    var serial = 0
    var suspended = false
    var isNote = false
    var radius: Float = 28
    var lastDraw = 0.0
    var renderable: Bool { !suspended && window?.isVisible == true && window?.isOnActiveSpace == true && window?.isMiniaturized == false }
    override var isOpaque: Bool { false }
    func limitResolution() {
        guard isNote else { return }
        let longest=max(bounds.width,bounds.height)
        let scale=min(window?.backingScaleFactor ?? 2,Fluid.noteEdge/max(1,longest))
        drawableSize=CGSize(width:max(1,bounds.width*scale),height:max(1,bounds.height*scale))
    }
    override func setFrameSize(_ size:NSSize) { super.setFrameSize(size); limitResolution() }
    var morphFrom: [SIMD4<Float>] = []
    var morphTo: [SIMD4<Float>] = []
    var morphStart = 0.0
    override func hitTest(_ point: NSPoint) -> NSView? { nil }
    init(frame: NSRect, backing: NSView, cells: [SIMD4<Float>], opacity: Float) {
        self.backing = backing
        self.cells = cells
        concentration = opacity
        super.init(frame:frame,device:Fluid.device)
        autoresizingMask = [.width,.height]
        colorPixelFormat = .bgra8Unorm
        clearColor = MTLClearColorMake(0,0,0,0)
        layer?.isOpaque = false
        enableSetNeedsDisplay = true
        isPaused = true
        preferredFramesPerSecond = 60
        delegate = self
        isHidden = true
    }
    required init(coder:NSCoder) { fatalError("Not used") }
    func fallback() { isHidden = true; backing?.isHidden = false; isPaused = true }
    func scale(_ time: Double) -> Float {
        let target: Float = pressed ? 1.07 : 1
        let t = Float(max(0,time-pressStart))
        return target+(fromScale-target)*exp(-12*t)*(cos(23*t)+12/23*sin(23*t))
    }
    func press(_ value: Bool) {
        fromScale = scale(ProcessInfo.processInfo.systemUptime)
        pressed = value
        pressStart = ProcessInfo.processInfo.systemUptime
        serial += 1
        let token = serial
        isPaused = false
        preferredFramesPerSecond=isNote ? Fluid.noteFPS*2 : (Fluid.lowPower ? 30 : 60)
        DispatchQueue.main.asyncAfter(deadline:.now()+0.7) { [weak self] in
            guard let self, self.serial == token else { return }
            self.isPaused = true
        }
    }
    func morph(_ start: [SIMD4<Float>], _ end: [SIMD4<Float>]) {
        morphFrom = start; morphTo = end
        morphStart = ProcessInfo.processInfo.systemUptime
        isPaused = false
        preferredFramesPerSecond=Fluid.lowPower ? 30 : 60
        serial += 1
        let token=serial
        DispatchQueue.main.asyncAfter(deadline:.now()+0.7) { [weak self] in
            guard let self, self.serial == token else { return }
            self.cells=end; self.morphFrom=[]; self.morphTo=[]; self.isPaused=true
        }
    }
    func mtkView(_ view: MTKView,drawableSizeWillChange size:CGSize) {}
    func draw(in view: MTKView) {
        guard renderable else { return }
        if isNote && isPaused {
            let now=ProcessInfo.processInfo.systemUptime
            guard now-lastDraw >= 1.0/Double(Fluid.noteFPS) else { return }
            lastDraw=now
        }
        if let screen = window?.screen,
           let id = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber,
           displayID != id.uint32Value {
            displayID = id.uint32Value
            fallback()
            Fluid.prune(); Fluid.start()
        }
        guard let window, window.isVisible, window.isOnActiveSpace, let screen = window.screen,
              let id = screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber,
              let capture = Fluid.captures[id.uint32Value], capture.active,
              let cv = capture.texture, let pixel = capture.pixel,
              let texture = CVMetalTextureGetTexture(cv), let pipeline = Fluid.pipeline,
              let pass = currentRenderPassDescriptor, let drawable = currentDrawable,
              let command = Fluid.queue?.makeCommandBuffer(), let encoder = command.makeRenderCommandEncoder(descriptor:pass) else { return }
        displayID = id.uint32Value
        let global = window.convertToScreen(convert(bounds,to:nil))
        let time = ProcessInfo.processInfo.systemUptime
        var moving = cells
        if !morphTo.isEmpty {
            let t = Float(max(0,time-morphStart))
            let response = min(1.06,1-exp(-12*t)*(cos(20*t)+12/20*sin(20*t)))
            moving = zip(morphFrom,morphTo).map { $0+($1-$0)*response }
        }
        let uniforms = [SIMD4<Float>(Float(bounds.width),Float(bounds.height),Float(global.minX-screen.frame.minX),Float(screen.frame.maxY-global.maxY)),
            SIMD4<Float>(Float(screen.frame.width),Float(screen.frame.height),concentration,Fluid.strength),
            SIMD4<Float>(Float(moving.count),scale(time),isNote ? 1 : 0,radius)] + moving
        encoder.setRenderPipelineState(pipeline)
        uniforms.withUnsafeBytes { encoder.setFragmentBytes($0.baseAddress!,length:$0.count,index:0) }
        encoder.setFragmentTexture(texture,index:0)
        encoder.drawPrimitives(type:.triangle,vertexStart:0,vertexCount:3)
        encoder.endEncoding()
        command.addCompletedHandler { _ in withExtendedLifetime((cv,pixel)) {} }
        command.present(drawable)
        command.commit()
        isHidden = false
        backing?.isHidden = true
        Fluid.status = "桌面折射运行中 · 胶囊上限\(Fluid.capsuleFPS)fps / 便签上限\(Fluid.noteFPS)fps"
    }
}

private enum Fluid {
    static var lowPower = false
    static var strength: Float = 1
    static var noteFPS: Int { lowPower ? 6 : 12 }
    static var capsuleFPS: Int { lowPower ? 12 : 24 }
    static var noteEdge: CGFloat { lowPower ? 512 : 768 }
    static let device = MTLCreateSystemDefaultDevice()
    static let queue = device?.makeCommandQueue()
    static var pipeline: MTLRenderPipelineState? = {
        guard let device else { return nil }
        do {
            let library = try device.makeLibrary(source:shader,options:nil)
            let descriptor = MTLRenderPipelineDescriptor()
            descriptor.vertexFunction = library.makeFunction(name:"fluidVertex")
            descriptor.fragmentFunction = library.makeFunction(name:"fluidFragment")
            let color = descriptor.colorAttachments[0]!
            color.pixelFormat = .bgra8Unorm
            color.isBlendingEnabled = true
            color.sourceRGBBlendFactor = .one
            color.destinationRGBBlendFactor = .oneMinusSourceAlpha
            color.sourceAlphaBlendFactor = .one
            color.destinationAlphaBlendFactor = .oneMinusSourceAlpha
            return try device.makeRenderPipelineState(descriptor:descriptor)
        } catch { NSLog("Fluid Metal: %@",String(describing:error)); return nil }
    }()
    static var views: [String:FluidView] = [:]
    static var captures: [CGDirectDisplayID:Capture] = [:]
    static var starting = false
    static var generation = 0
    static var status = "未启用流体玻璃"
    static var monitor: Timer?
    static var observers: [NSObjectProtocol] = []
    static var workspaceObservers: [NSObjectProtocol] = []
    static var sleeping = false
    static var retryAfter = 0.0
    static func needed() -> Set<CGDirectDisplayID> {
        if sleeping { return [] }
        return Set(views.values.compactMap {
            guard $0.renderable, let window=$0.window else { return nil }
            return (window.screen?.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber)?.uint32Value
        })
    }
    static func watch() {
        guard monitor == nil else { return }
        workspaceObservers.append(NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.willSleepNotification, object: nil, queue: .main) { _ in
            sleeping = true
            generation += 1; starting = false
            prune()
        })
        workspaceObservers.append(NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didWakeNotification, object: nil, queue: .main) { _ in
            sleeping = false
            retryAfter = 0
            start()
        })
        for name in [NSWindow.didMoveNotification,NSWindow.didResizeNotification] {
            observers.append(NotificationCenter.default.addObserver(forName:name,object:nil,queue:.main) { note in
                guard let window=note.object as? NSWindow else { return }
                for view in views.values where view.window === window && !view.suspended { view.draw() }
            })
        }
        observers.append(NotificationCenter.default.addObserver(forName:NSApplication.didChangeScreenParametersNotification,object:nil,queue:.main) { _ in
            generation += 1; starting=false
            for capture in captures.values { capture.stop() }
            captures.removeAll(); start()
        })
        monitor=Timer.scheduledTimer(withTimeInterval:1,repeats:true) { _ in
            prune(); start()
        }
        monitor?.tolerance=0.2
    }
    static func start() {
        let required=needed()
        guard !starting, !views.isEmpty, !required.isEmpty,
              required.contains(where: { captures[$0]?.active != true }),
              ProcessInfo.processInfo.systemUptime>=retryAfter else { return }
        guard CGPreflightScreenCaptureAccess() else { status = "需要屏幕录制权限，当前使用弹性玻璃"; return }
        guard pipeline != nil else { status = "Metal 不可用，当前使用弹性玻璃"; return }
        starting = true
        let token = generation
        SCShareableContent.getExcludingDesktopWindows(false,onScreenWindowsOnly:false) { content,error in
            DispatchQueue.main.async {
                guard generation == token else { return }
                starting = false
                guard let content else { status = "无法读取屏幕，当前使用弹性玻璃"; retryAfter=ProcessInfo.processInfo.systemUptime+15; return }
                let needed = needed()
                for display in content.displays where needed.contains(display.displayID) && captures[display.displayID]?.active != true {
                    do { captures[display.displayID] = try Capture(display:display,content:content) }
                    catch { status = "采样启动失败，当前使用弹性玻璃"; retryAfter=ProcessInfo.processInfo.systemUptime+15 }
                }
            }
        }
    }
    static func prune() {
        let needed = needed()
        if needed.isEmpty && !views.isEmpty { status="无可见流体窗口，背景采样已暂停" }
        for id in Array(captures.keys) where !needed.contains(id) { captures.removeValue(forKey:id)?.stop() }
        for (id,capture) in captures {
            capture.rate(views.values.contains { $0.displayID == id && !$0.isNote && $0.renderable } ? capsuleFPS : noteFPS)
        }
        if views.isEmpty { generation += 1; starting = false; status = "未启用流体玻璃"; monitor?.invalidate(); monitor=nil
            for token in observers { NotificationCenter.default.removeObserver(token) }; observers.removeAll()
            for token in workspaceObservers { NSWorkspace.shared.notificationCenter.removeObserver(token) }; workspaceObservers.removeAll()
            sleeping = false
        }
    }
}

// Live budget changes reuse views and capture, preserving editor/input state.
@_cdecl("hermes_fluid_config")
func configure(_ lowPower:Int32,_ strength:Double) {
    let changed=Fluid.lowPower != (lowPower != 0) || Fluid.strength != Float(strength)
    guard changed else { return }
    Fluid.lowPower=lowPower != 0; Fluid.strength=Float(min(1,max(0,strength)))
    Fluid.prune()
    for view in Fluid.views.values {
        view.limitResolution()
        if !view.isPaused { view.preferredFramesPerSecond=view.isNote ? Fluid.noteFPS*2 : (Fluid.lowPower ? 30 : 60) }
        view.draw()
    }
}
@_cdecl("hermes_fluid_install")
func install(_ raw: UnsafeMutableRawPointer, _ backingRaw: UnsafeMutableRawPointer, _ label: UnsafePointer<CChar>, _ rects: UnsafePointer<Double>, _ count: Int32, _ opacity: Double) {
    let key = String(cString:label)
    if let old = Fluid.views.removeValue(forKey:key) { old.fallback(); old.removeFromSuperview() }
    guard count > 0, count <= 12, Fluid.pipeline != nil else { return }
    let window = Unmanaged<NSWindow>.fromOpaque(raw).takeUnretainedValue()
    let backing = Unmanaged<NSView>.fromOpaque(backingRaw).takeUnretainedValue()
    guard let root = window.contentView else { return }
    let cells = (0..<Int(count)).map { i -> SIMD4<Float> in
        let x=rects[i*4], y=rects[i*4+1], w=rects[i*4+2], h=rects[i*4+3]
        return SIMD4<Float>(Float(x+w/2),Float(y+h/2),count == 1 ? 20 : 22,0)
    }
    let view = FluidView(frame:root.bounds,backing:backing,cells:cells,opacity:Float(opacity))
    if let id = window.screen?.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber { view.displayID=id.uint32Value }
    root.addSubview(view,positioned:.above,relativeTo:backing)
    Fluid.views[key] = view
    Fluid.watch()
    Fluid.prune()
    Fluid.start()
}
@_cdecl("hermes_fluid_note")
func note(_ raw:UnsafeMutableRawPointer,_ backingRaw:UnsafeMutableRawPointer,_ label:UnsafePointer<CChar>,_ radius:Double,_ opacity:Double) {
    let key=String(cString:label)
    if let old=Fluid.views.removeValue(forKey:key) { old.fallback(); old.removeFromSuperview() }
    guard Fluid.pipeline != nil else { return }
    let window=Unmanaged<NSWindow>.fromOpaque(raw).takeUnretainedValue()
    let backing=Unmanaged<NSView>.fromOpaque(backingRaw).takeUnretainedValue()
    guard let root=window.contentView else { return }
    let view=FluidView(frame:root.bounds,backing:backing,cells:[],opacity:Float(opacity))
    view.isNote=true; view.radius=Float(radius); view.autoResizeDrawable=false
    if let id=window.screen?.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? NSNumber { view.displayID=id.uint32Value }
    root.addSubview(view,positioned:.above,relativeTo:backing)
    view.limitResolution()
    Fluid.views[key]=view
    Fluid.watch(); Fluid.prune(); Fluid.start()
}
@_cdecl("hermes_fluid_remove")
func remove(_ label: UnsafePointer<CChar>) {
    if let old = Fluid.views.removeValue(forKey:String(cString:label)) { old.fallback(); old.removeFromSuperview() }
    Fluid.prune()
}
@_cdecl("hermes_fluid_press")
func press(_ label: UnsafePointer<CChar>, _ pressed:Int32) { Fluid.views[String(cString:label)]?.press(pressed != 0) }
@_cdecl("hermes_fluid_visible")
func visible(_ label: UnsafePointer<CChar>, _ value:Int32) {
    guard let view = Fluid.views[String(cString:label)] else { return }
    view.suspended = value == 0
    view.isHidden = value == 0
    if value != 0 { view.draw() }
}
@_cdecl("hermes_fluid_morph")
func morph(_ label: UnsafePointer<CChar>, _ start: UnsafePointer<Double>, _ end: UnsafePointer<Double>, _ count:Int32) {
    guard let view = Fluid.views[String(cString:label)] else { return }
    func cells(_ rects:UnsafePointer<Double>) -> [SIMD4<Float>] {
        (0..<Int(count)).map { i in
            SIMD4<Float>(Float(rects[i*4]+rects[i*4+2]/2),Float(rects[i*4+1]+rects[i*4+3]/2),Float(min(rects[i*4+2],rects[i*4+3])/2),0)
        }
    }
    view.morph(cells(start),cells(end))
}
@_cdecl("hermes_fluid_status")
func status(_ output: UnsafeMutablePointer<CChar>, _ capacity:Int32) {
    let bytes = Array(Fluid.status.utf8.prefix(max(0,Int(capacity)-1))) + [0]
    for (i,byte) in bytes.enumerated() { output[i] = CChar(bitPattern:byte) }
}
@_cdecl("hermes_fluid_request")
func request() {
    Fluid.retryAfter=0
    if !CGPreflightScreenCaptureAccess() { _ = CGRequestScreenCaptureAccess() }
    Fluid.start()
}
// Offscreen GPU smoke check. Never starts capture or asks for permission.
@_cdecl("hermes_fluid_selftest")
func selftest() -> Int32 {
    smoke(false)
}
@_cdecl("hermes_fluid_note_selftest")
func noteSelftest() -> Int32 {
    smoke(true)
}
private func smoke(_ note:Bool) -> Int32 {
    guard let device=Fluid.device, let pipeline=Fluid.pipeline,
          let command=Fluid.queue?.makeCommandBuffer() else { return 0 }
    let outputDescription=MTLTextureDescriptor.texture2DDescriptor(pixelFormat:.bgra8Unorm,width:88,height:64,mipmapped:false)
    outputDescription.storageMode = .shared
    outputDescription.usage = [.renderTarget]
    let inputDescription=MTLTextureDescriptor.texture2DDescriptor(pixelFormat:.bgra8Unorm,width:1,height:1,mipmapped:false)
    inputDescription.storageMode = .shared
    inputDescription.usage = [.shaderRead]
    guard let output=device.makeTexture(descriptor:outputDescription),let input=device.makeTexture(descriptor:inputDescription) else { return 0 }
    let color:[UInt8]=[80,100,120,255]
    color.withUnsafeBytes { input.replace(region:MTLRegionMake2D(0,0,1,1),mipmapLevel:0,withBytes:$0.baseAddress!,bytesPerRow:4) }
    let pass=MTLRenderPassDescriptor()
    pass.colorAttachments[0].texture=output
    pass.colorAttachments[0].loadAction = .clear
    pass.colorAttachments[0].storeAction = .store
    pass.colorAttachments[0].clearColor=MTLClearColorMake(0,0,0,0)
    guard let encoder=command.makeRenderCommandEncoder(descriptor:pass) else { return 0 }
    let uniforms:[SIMD4<Float>]=[SIMD4(88,64,0,0),SIMD4(88,64,0.25,0),SIMD4(2,1,note ? 1 : 0,20),SIMD4(22,22,22,0),SIMD4(46,22,22,0)]
    encoder.setRenderPipelineState(pipeline)
    uniforms.withUnsafeBytes { encoder.setFragmentBytes($0.baseAddress!,length:$0.count,index:0) }
    encoder.setFragmentTexture(input,index:0)
    encoder.drawPrimitives(type:.triangle,vertexStart:0,vertexCount:3)
    encoder.endEncoding()
    command.commit(); command.waitUntilCompleted()
    guard command.error == nil else { return 0 }
    var pixels=[UInt8](repeating:0,count:88*64*4)
    pixels.withUnsafeMutableBytes { output.getBytes($0.baseAddress!,bytesPerRow:88*4,from:MTLRegionMake2D(0,0,88,64),mipmapLevel:0) }
    return pixels[3] == 0 && pixels[(22*88+34)*4+3] > 240 ? 1 : 0
}
