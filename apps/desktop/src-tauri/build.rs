fn main() {
    let target = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    if target == "macos" {
        cc::Build::new()
            .file("native/streamer_macos.m")
            .flag("-fobjc-arc")
            .flag("-fblocks")
            .compile("mlsm_streamer_macos");
        for framework in [
            "ScreenCaptureKit",
            "CoreMedia",
            "CoreAudio",
            "AudioToolbox",
            "CoreGraphics",
            "Foundation",
            "AppKit",
        ] {
            println!("cargo:rustc-link-lib=framework={framework}");
        }
    } else if target == "windows" {
        cc::Build::new()
            .cpp(true)
            .file("native/streamer_windows.cpp")
            .define("UNICODE", None)
            .define("_UNICODE", None)
            .define("_WIN32_WINNT", "0x0A00")
            .flag_if_supported("/std:c++17")
            .compile("mlsm_streamer_windows");
        for library in ["ole32", "mmdevapi", "propsys", "avrt", "runtimeobject"] {
            println!("cargo:rustc-link-lib={library}");
        }
    }
    println!("cargo:rerun-if-changed=native/streamer_macos.m");
    println!("cargo:rerun-if-changed=native/streamer_windows.cpp");
    tauri_build::build()
}
