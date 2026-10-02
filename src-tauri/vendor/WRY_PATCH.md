# Wry 0.55.1 macOS focus patch

Source: crates.io wry 0.55.1, https://github.com/tauri-apps/wry (MIT/Apache-2.0; licenses retained inside `wry/`). This is the existing locked version, not a dependency upgrade.

Only behavioral change: `src/wkwebview/mod.rs` wraps NSApplication activation during WebView creation in `if attributes.focus`. Upstream activates the application unconditionally even when a hidden window is built with `focused(false)`, so background capsule/preview creation can steal focus.

Hermes builds initially hidden windows with `focused(false)` and lets explicit show/edit actions focus them. Tauri/Windows/Linux behavior is unchanged by the macOS-only patch. The application keeps M2's startup policy guard for Tao's separate launch activation.

Cargo uses `[patch.crates-io] wry = { path = "vendor/wry" }`. Keep this source checked in so clean builds reproduce the fix. When upstream honors the flag, verify quiet startup/hidden preview and remove this patch while deliberately updating the dependency lockfile.

## Tao 0.35.3 launch companion

Also retain the existing locked `tao` 0.35.3 source from crates.io / https://github.com/tauri-apps/tao, including MIT/Apache-2.0 licenses. One change in `src/platform_impl/macos/app_state.rs`: skip the launch-time activateIgnoringOtherApps call when the app's configured policy is Prohibited. Otherwise Tao still requests activation during a quiet launch; the app restores Regular policy at Ready.

Both changes are macOS-only. Future dependency updates should first verify both quiet launch and background WKWebView creation and then remove these path patches when upstream equivalents exist.
