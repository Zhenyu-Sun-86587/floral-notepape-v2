# Editor architecture — 1.7.5

便签正文采用 **Persistent Source Editor + Derived Markdown Presentation**。本版只纠正 Editor，保留 1.7.4 Capsule geometry、动画、拖动与颜色。

## Source of Truth

`SourceEditor` 在便签挂载时创建一个 CodeMirror `EditorView`，仅在组件卸载时销毁。`EditorState.doc` 是当前编辑会话的源码 authority；负责 selection、undo/redo、IME、快捷键、列表延续与代码语法高亮。编辑态显示完整 Markdown 源码，不隐藏标记、不替换富文本块。

NotePad 的正文值继续作为保存/外部更新适配输入。编辑事务先进入 CodeMirror，再通过 `onChange` 通知既有保存管线；外部更新通过最小 `ChangeSet` 回到同一实例，不重建文档或历史。IME 期间推迟外部更新与读写交接。

## Derived presentation

`MarkdownSurface` 从 `EditorState.doc.toString()` 获取只读快照，交给现有 `MarkdownPreview`：react-markdown、remark-gfm/math、KaTeX、代码高亮、图片 resolver 与 Mermaid。编辑期间冻结快照，退出编辑前同步最新源码。

**Markdown View is not a second editable document.** 它没有独立正文写入或保存逻辑。阅读态任务根据 AST 记录的偏移，通过编辑器事务仅修改任务标记中的一个字符，随后沿用 NotePad 自动保存及 linked revision/conflict safety。阅读链接直接打开；编辑态普通点击定位，Ctrl/Cmd+Click 打开链接。

## Source position bridge

`rehypeSourcePosition` 在 KaTeX/代码渲染前为语义节点登记 AST `position.start/end.offset`，并补上隐藏 Frontmatter 的偏移。可逐 UTF-16 单元对应的文本 leaf 使用无视觉样式的 inline span。

浏览器 `caretPositionFromPoint` / `caretRangeFromPoint` 返回文本节点与 DOM offset，`sourcePosition.ts` 将其映射到源码。粗体/链接标签使用其 Text 节点位置，不猜测标记宽度。实体、转义、容器续行等文本不一一对应时回退到当前语义范围；code、math、image、Mermaid 使用块/节点级落点，不映射 SVG 内部节点。

离开编辑记录 source caret + viewport Y，阅读层找到最小包含范围并恢复锚点；进入编辑使用点击 offset + Y，通过 CodeMirror 实际坐标校正同一 Tile 滚动容器。没有滚动比例、固定字符宽度或 marker em 估算。异步图片/图表布局继续校正；用户滚动/点击后停止自动补偿。文档首尾受实际可滚动范围约束。

## Focus-driven layering

活动层参与正常流；另一层为绝对定位、零高度、不可命中、`inert` / `aria-hidden`。两层共享外部 scroll context；CodeMirror 始终 mounted。主动点击新位置替换原选区，键盘/工具栏重入保留原选区。拖选阅读文本不触发编辑，任务/链接/按钮优先处理自身操作。工具栏、输入框、对话框与菜单的内部焦点交接不结束编辑；中文组合输入期间不隐藏编辑器。

此实现参考 [PaperTodo 的交互语义与文档边界](https://github.com/snownico0722/PaperTodo/blob/main/doc/DECISIONS.md)，未复制其源码、资源、AvalonEdit visual generators 或实现代码。

## Validation boundary

测试验证 AST 标注、DOM offset、任务单字符补丁、实例身份、跨读写撤销、事件优先级和 IME 门控。DOM 模拟没有真实排版或输入法，不能证明几何与候选框体验；真实 GUI 验收见 [MANUAL_ACCEPTANCE](MANUAL_ACCEPTANCE.md)。历史 1.7.2–1.7.4 中的 CodeMirror pseudo-WYSIWYG 说明已由本文件取代。
