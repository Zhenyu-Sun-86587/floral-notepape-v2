fn main() {
    println!("cargo:rustc-check-cfg=cfg(folio_private_container_experiment)");
    println!("cargo:rerun-if-env-changed=FOLIO_WIDGET_CONTAINER_EXPERIMENT");
    if std::env::var("FOLIO_WIDGET_CONTAINER_EXPERIMENT").as_deref() == Ok("1") {
        assert_eq!(std::env::var("CARGO_CFG_TARGET_OS").as_deref(), Ok("macos"));
        println!("cargo:rustc-cfg=folio_private_container_experiment");
    }
    let conf = std::fs::read_to_string("tauri.conf.json").expect("read tauri.conf.json");
    let parsed: serde_json::Value = serde_json::from_str(&conf).expect("parse tauri.conf.json");
    let version = parsed["version"]
        .as_str()
        .expect("tauri.conf.json must have a \"version\" string field");
    println!("cargo:rustc-env=TAURI_CONF_VERSION={version}");
    println!("cargo:rerun-if-changed=tauri.conf.json");

    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        let out = std::path::PathBuf::from(std::env::var_os("OUT_DIR").unwrap());
        let arch = std::env::var("CARGO_CFG_TARGET_ARCH").unwrap();
        let arch = if arch == "aarch64" { "arm64" } else { "x86_64" };
        let target = format!("{arch}-apple-macosx15.0");
        let result = std::process::Command::new("xcrun")
            .args([
                "swiftc",
                "-swift-version",
                "5",
                "-O",
                "-parse-as-library",
                "-emit-library",
                "-static",
                "-module-name",
                "HermesFluid",
                "-target",
                &target,
                "native/FluidGlass.swift",
                "-o",
            ])
            .arg(out.join("libHermesFluid.a"))
            .status()
            .expect("Mac Swift compiler");
        assert!(result.success(), "Mac fluid module failed to compile");
        let result = std::process::Command::new("xcrun")
            .args([
                "swiftc",
                "-swift-version",
                "5",
                "-O",
                "-parse-as-library",
                "-emit-library",
                "-static",
                "-module-name",
                "FolioWidgetBridge",
                "-target",
                &target,
                "native/widgets/Shared.swift",
                "native/widgets/Bridge.swift",
                "-o",
            ])
            .arg(out.join("libFolioWidgetBridge.a"))
            .status()
            .expect("Mac WidgetKit bridge compiler");
        assert!(result.success(), "Mac WidgetKit bridge failed to compile");
        println!("cargo:rerun-if-changed=native/widgets/Shared.swift");
        println!("cargo:rerun-if-changed=native/widgets/Bridge.swift");
        println!("cargo:rustc-link-lib=static=FolioWidgetBridge");
        println!("cargo:rerun-if-changed=native/FluidGlass.swift");
        println!("cargo:rustc-link-search=native={}", out.display());
        println!("cargo:rustc-link-lib=static=HermesFluid");
        for framework in [
            "ScreenCaptureKit",
            "MetalKit",
            "Metal",
            "CoreVideo",
            "CoreMedia",
            "QuartzCore",
            "AppKit",
            "Foundation",
            "WidgetKit",
        ] {
            println!("cargo:rustc-link-lib=framework={framework}");
        }
        println!("cargo:rustc-link-lib=dylib=swiftCore");
        println!("cargo:rustc-link-lib=dylib=swift_Concurrency");
        println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
    }

    tauri_build::build()
}
