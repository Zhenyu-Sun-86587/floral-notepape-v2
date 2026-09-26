# 1.7.2 常驻 Markdown 编辑器与胶囊修复

## 行为研究

研究 [PaperTodo 当前 main](https://github.com/snownico0722/PaperTodo) 的 `PaperWindow.Note.cs`、`MarkdownTextBox.cs`、`MarkdownSemanticPresentation.cs`、`MarkdownSemanticPresentation.RevealFade.cs`、`MarkdownSemanticPresentation.Colorizer.cs`、`MarkdownTextBox.TaskCheckBoxes.cs`、`EdgeCapsuleHost.Preview.cs`、`EdgeCapsulePreview.Markdown.cs` 以及 ARCHITECTURE、DECISIONS、USER_GUIDE.en 文档。

采用的产品原则：同一个源码文档/编辑控件；焦点只改变呈现；先在当前布局命中字符，再显露语法；任务与链接优先于进入编辑；预览窗口没有第二个正文编辑器。PaperTodo 使用 AvalonEdit/Markdig；本项目独立使用 MIT 许可的 CodeMirror/Lezer 与现有 React 渲染器，没有复制或翻译其实现代码、资源。

## 代码职责

- `SourceEditor.tsx`：一个 EditorView 持续存在，源码是唯一可编辑状态；受控内容只用于既有保存/冲突管线。光标命中由 `posAtCoords` 完成，装饰直接引用源码范围。外部内容用最小 ChangeSet 更新，不重建文档/撤销栈。
- `sourceDocument.ts`：外部文本差异及公式源码节点；通用 Markdown grammar 使用 Lezer。常用标记由 Decoration 隐藏或替换。复杂块 Widget 复用 MarkdownPreviewLazy，按源码与资源参数复用相同 DOM。
- `NotePad.tsx`：仍拥有保存、冲突、平台窗口附着、锁定、快捷键。焦点状态不再决定正文控件是否存在；Esc/失焦保存失败时沿用错误反馈。
- `CapsulePreview.tsx`：任务先更新当前 owner/generation 的正文，随后按原 revision 保存。保存期间通知合并；相同正文核对不会再次 setPreview，失败回滚。任务 mutation epoch 阻止旧读取覆盖乐观状态，稳定的组件定义/任务回调避免重新挂载正文节点。预览仅含任务、链接、滚动、展开与编辑入口。

## 性能边界

语法树增量解析；常用 Markdown 不逐键调用 React Markdown 渲染器。装饰在文档、解析树、活动行或显示配置改变时更新，同一行内移动光标不重建装饰；块高度不随虚拟视口删除，以免滚动跳动。CodeMirror 负责可见 DOM 虚拟化，复杂块按 Widget 内容相等复用。装饰更新仍遍历语法节点，大型文件需要实测，不声称 O(1)。

未增加常驻轮询、预览窗口或 WebView。Windows 原生胶囊布局直接定位，CSS 负责内部反馈；现有鼠标拖动期间的短期原生采样保留，松手后只保存一次会话。没有帧率和内存实测。

## 已知边界

复杂块进入编辑时显露该块源码，不提供表格单元格/公式的 WYSIWYG 编辑。仍有显式写作按钮作为键盘与空白便签入口。Windows 为开发平台，Mac 构建和 GUI 均未验证；共享编辑器不含 Windows 专用代码，原生桌面附着和整组拖动继续由平台层适配。
