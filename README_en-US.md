# Hermes Surface Dev

[简体中文](README.md) · [繁體中文](README_zh-HK.md) · **English**

Keep Markdown notes on your desktop, edit them in place, and tuck them into a screen edge when you need space.

[Download Windows 1.7.2](https://github.com/Zhenyu-Sun-86587/floral-notepape-v2/releases/tag/v1.7.2) · [Report an issue](https://github.com/Zhenyu-Sun-86587/floral-notepape-v2/issues) · [中文说明](README.md)

**Platform status:** A Windows x64 NSIS installer is available. macOS is being adapted by a collaborator; this fork has no Mac installer yet. Version 1.7.5 separates persistent CodeMirror source editing from derived MarkdownPreview reading through AST source positions. Capsules retain 1.7.4 behavior. Click placement, scroll continuity and IME still need manual GUI validation. See [project status](Docs/STATUS.md).

## Features

- Pin internal notes or bound external Markdown files as independent desktop notes. Bound files are edited in place; importing Markdown creates an internal copy.
- Switch between reading and writing within the same note window. The preview supports task lists, code, math, images, and Mermaid on demand.
- On Windows, choose a normal, always-on-top, or desktop-attached window. Locking makes the note body pass mouse input through while leaving the lock icon available for unlocking.
- Store a note as a slim strip on the left, right, or top edge. Drag it between edges or screens, hover to preview, and click to restore its previous size and position.
- Adjust themes and appearance; restore notes from the tray, startup policy, or configured shortcuts.

## Install

Get the [Windows x64 installer](https://github.com/Zhenyu-Sun-86587/floral-notepape-v2/releases/download/v1.7.2/Hermes.Surface.Dev_1.7.2_x64-setup.exe) and [SHA256SUMS.txt](https://github.com/Zhenyu-Sun-86587/floral-notepape-v2/releases/download/v1.7.2/SHA256SUMS.txt) from this fork's release. The installer is unsigned and downloads WebView2 Runtime if it is missing. This fork does not currently distribute a Microsoft Store, MirrorChyan, Windows ARM64, or macOS build.

For development, run the following in PowerShell 7 on Windows:

```powershell
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
npm ci
npm run tauri build -- --bundles nsis
```

Mac collaborators should follow the [macOS handoff](Docs/MAC_HANDOFF.md) for app identity, native window behavior, building, and manual acceptance. See the [P8 report](Docs/P8_FINAL.md) for implementation status, limitations, and resource measurement boundaries.

## Origin and license

This project is a fork of [Achilng/floral-notepaper](https://github.com/Achilng/floral-notepaper) and retains its history and copyright notices. It is distributed under the [MIT license](LICENSE); see [upstream attribution](Docs/UPSTREAM.md) and [third-party notices](THIRD_PARTY_NOTICES.md). The upstream project's releases, store listing, signing, and mirrors are separate from this fork.
