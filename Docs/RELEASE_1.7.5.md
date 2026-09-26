# Hermes Surface 1.7.5 — Editor architecture correction

本版将阅读态移回成熟 MarkdownPreview；编辑态是显示全部 Markdown 标记的常驻 CodeMirror source editor。Capsule 完全冻结，保留 1.7.4 几何修正。

- 新增 MarkdownSurface，协调 AST 源码位置桥接、焦点切换、选区与滚动锚点。
- 删除 containerPrefix、sourcePresentation 及实验性排版测试；移除 PrefixCell、固定 em 槽、RichBlock replacement 和伪水平线。
- 复用列表、任务、表格、代码、KaTeX、图片 resolver/受阻占位与 Mermaid 管线。
- 阅读任务直接派发 CodeMirror 单字符事务；普通链接点击直接打开。正文点击定位；编辑态保留 Ctrl/Cmd+Click、中文 IME、外部更新与撤销历史。
- 编辑时冻结派生快照，避免逐键重渲染 Markdown/Mermaid；非活动层不参与布局/Tab 顺序。
- 版本源统一为 1.7.5；仅新增 jsdom 开发依赖，用于组件生命周期与 DOM 映射测试。

架构与已知映射回退见 [EDITOR_ARCHITECTURE](EDITOR_ARCHITECTURE.md)。实体、转义文本与复杂块允许语义范围落点；真实滚动位置、IME、图片加载与主题对比度仍需人工验证。

## 验证

- `npm test`：31 个测试文件、144 项通过；最终语义色/表格范围修正后，相关 23 项测试再次通过。
- `npm run build`、`npm run lint`、`cargo check --manifest-path src-tauri/Cargo.toml --locked`：通过。
- `npm run tauri build -- --bundles nsis`：最终 Windows x64 production / NSIS 构建通过。
- 安装包：`Hermes Surface Dev_1.7.5_x64-setup.exe`，19,649,426 bytes。
- 构建保留非阻塞的 chunk 大小及 CodeMirror HTML 动态/静态导入提示，未扩展本版范围去重构打包。
  Windows GUI 与 macOS 均为 **manual verification required**；不运行 E2E，不把构建成功视为体验已验收。

发布流程为提交并推送当前 main；不创建 PR 或 GitHub Release。安装包保存在本地 `src-tauri/target/release/bundle/nsis/`。

安装包 SHA-256：

0440EAAA1E8EAD6D1FA2671A55484DBCAEF4FAB140C0350A73BAF69AC74520A9
