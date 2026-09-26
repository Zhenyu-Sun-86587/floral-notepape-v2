# Hermes Surface 1.7.4 — Markdown Presentation / Capsule Viewport

基线：`5c2ff302331353948c9cf863248634cfd400c91b`。开始时仅有两份既有未跟踪构建日志；它们保留且不纳入本次提交。

## 变化

- 胶囊布局保留逻辑 CSS 单位（slot 44、grip 14、cross 18），只在原生窗口边界转换为物理像素。边界转换按整组端点计算，并对四舍五入可能损失的末端像素向外补偿；靠工作区末端时平移窗口以保持组完整。视觉组仍对应一个 WebView。
- 普通胶囊组使用不可滚动的 viewport/strip；只有内容真正超过边缘容量时才启用内部滚动。成员 cross axis 填满窗口，不再用反推的 `physical / scale` 设置 CSS 尺寸。
- Markdown 列表、任务、引用由 Lezer 标记组成完整语义前缀；任务框占用所属列表 marker 的位置。活动行直接显露源码，阅读态由单个视觉槽呈现，源码和偏移不变。
- 水平线使用行级全宽分隔线；补齐裸 URL 的链接呈现与点击、Setext/H4–H6 标题、普通 fenced code 的语言高亮、禁用远程图片时的说明占位、GFM 表格对齐。
- 便签按背景色计算 primary/secondary/muted/accent 语义文字色；正文不再叠加额外透明度。编辑器和只读 Markdown 使用同一组局部色值。
- 常驻 CodeMirror、IME 保护、undo/redo、外部最小变更、图片/数学公式/表格/Mermaid RichBlock 和胶囊组窗口机制保留。

新增代码语言包仅用于常见 fenced code 的 CodeMirror 嵌套语法高亮：TypeScript/JavaScript、JSON、Python、Rust、HTML、CSS、Shell/Bash。`text` fence 不启用 Markdown 语义解析。

固定人工回归文本：[markdown-presentation-1.7.4.md](fixtures/markdown-presentation-1.7.4.md)。Lezer 树审计确认了 `Table`、`TaskMarker`、`URL`、`FencedCode/CodeText`、`HorizontalRule`、`Image`、inline emphasis/link/list/quote 等节点；现有扩展继续提供 `InlineMath` 与 `DisplayMath`。未引入第二套 Markdown parser。

## 验证与边界

- `npm test`：31 个文件、142 项通过。`npm run lint` 与 TypeScript/前端 production build：通过。
- `cargo test capsule --lib`：11 项通过；`cargo check`：通过。
- Windows Tauri release / NSIS：通过。安装包 `src-tauri/target/release/bundle/nsis/Hermes Surface Dev_1.7.4_x64-setup.exe`，19,652,326 bytes，SHA-256 `E50EC33D46DE4223925E45C5124984D11F387EE9F6003A718C637DA756018E7D`。主程序 ProductVersion/FileVersion 均为 1.7.4。

Windows 各 DPI 真机、混合 DPI、多显示器、Markdown 光标与软换行、macOS 体验均为 **manual verification required**；构建通过不等于 GUI 验收。未运行浏览器 E2E。

物理端点直接四舍五入在某些小数起点会少于 DOM 内容所需宽度，因此窗口末端最多补足一个物理像素。这个补偿发生在唯一的 native 投影层，CSS 仍使用原始逻辑尺寸。

PaperTodo 只用于比较行为和单一 authority 原则；本次 React/Tauri/CodeMirror 实现独立完成，未复制其源码或资源。
