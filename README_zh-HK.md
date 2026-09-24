# Hermes Surface Dev

[简体中文](README.md) · **繁體中文** · [English](README_en-US.md)

將 Markdown 筆記固定在桌面，需要時直接編輯，暫時不用時收納至螢幕邊緣。

[下載 Windows 1.6.0](https://github.com/Zhenyu-Sun-86587/floral-notepape-v2/releases/tag/v1.6.0) · [回報問題](https://github.com/Zhenyu-Sun-86587/floral-notepape-v2/issues) · [简体中文](README.md)

**平台狀態：**目前提供 Windows x64 NSIS 安裝程式。macOS 正由協作者適配，本 fork 尚無 Mac 安裝包。1.6.0 新增的拖動和陰影仍待人工 GUI 驗收；詳見[項目狀態](Docs/STATUS.md)。

## 功能

- 將內部筆記或已綁定的外部 Markdown 檔案固定為獨立便箋。綁定檔案會寫回原檔；匯入 Markdown 則建立應用程式內的副本。
- 在同一便箋視窗切換閱讀與寫作。預覽支援待辦清單、程式碼、公式、圖片與按需載入的 Mermaid。
- Windows 提供普通、置頂與桌面附著模式。鎖定時便箋主體讓滑鼠事件穿透，原鎖圖示仍可解鎖。
- 將便箋收納到左側、右側或頂部的細色條；可以拖到其他邊緣或螢幕，懸停預覽，按一下恢復原本的位置與尺寸。
- 可調整主題和外觀，並透過系統匣、自啟動策略與快捷鍵喚回便箋。

## 下載與開發

從本 fork 的 [Release](https://github.com/Zhenyu-Sun-86587/floral-notepape-v2/releases/tag/v1.6.0) 下載 [Windows x64 安裝包](https://github.com/Zhenyu-Sun-86587/floral-notepape-v2/releases/download/v1.6.0/Hermes.Surface.Dev_1.6.0_x64-setup.exe)與 `SHA256SUMS.txt`。安裝包未簽署；若系統缺少 WebView2 Runtime，安裝時需要連線下載。本 fork 目前沒有 Microsoft Store、Mirror 醬、Windows ARM64 或 macOS 產物。

在 Windows 的 PowerShell 7 中從原始碼構建：

```powershell
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
npm ci
npm run tauri build -- --bundles nsis
```

Mac 協作者請參閱 [macOS 開發交接](Docs/MAC_HANDOFF.md)；實作狀態與保留項見 [P8 報告](Docs/P8_FINAL.md)。

## 來源與授權

本項目從 [Achilng/floral-notepaper](https://github.com/Achilng/floral-notepaper) fork 開發，保留原倉庫歷史與版權聲明。採用 [MIT 授權](LICENSE)；詳見[上游來源](Docs/UPSTREAM.md)及[第三方資源聲明](THIRD_PARTY_NOTICES.md)。上游商店、簽署與下載渠道不屬於本 fork。
