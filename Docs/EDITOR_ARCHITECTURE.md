# Editor architecture — macOS inline editing (2.0.5 follow-up)

便签正文采用 **Persistent Source Editor + Derived Markdown Presentation**。沿用已有 Tauri、React、CodeMirror 和双层协调结构。Mac 便签与胶囊面板增量支持原位编辑；主窗口及其他平台保留原来的编辑模式。

## Source of Truth

`SourceEditor` 在便签挂载时创建一个 CodeMirror `EditorView`，仅在组件卸载时销毁。`EditorState.doc` 是当前编辑会话的源码 authority；负责 selection、undo/redo、IME、快捷键、列表延续与代码语法高亮。默认 `presentation="source"` 显示完整源码；Mac 便签和胶囊传入 `presentation="live"`，以 Lezer 范围生成视觉装饰。非活动标记折叠，标题、强调、列表和代码保留排版；图片、表格、公式、Mermaid 复用现有 MarkdownPreview。光标进入后只展开相应范围。装饰不修改源码，不维护第二份可写文档。

NotePad 的正文值继续作为保存/外部更新适配输入。编辑事务先进入 CodeMirror，再通过 `onChange` 通知既有保存管线；外部更新通过最小 `ChangeSet` 回到同一实例，不重建文档或历史。IME 期间推迟外部更新与读写交接。

## Derived presentation

`MarkdownSurface` 从 `EditorState.doc.toString()` 获取只读快照，交给现有 `MarkdownPreview`：react-markdown、remark-gfm/math、KaTeX、代码高亮、图片 resolver 与 Mermaid。编辑期间冻结快照，退出编辑前同步最新源码。

**Markdown View is not a second editable document.** 它没有独立正文写入或保存逻辑。阅读态任务根据 AST 记录的偏移，通过编辑器事务仅修改任务标记中的一个字符，随后沿用 NotePad 自动保存及 linked revision/conflict safety。阅读链接直接打开；编辑态普通点击定位，Ctrl/Cmd+Click 打开链接。

## Source position bridge

`rehypeSourcePosition` 在 KaTeX/代码渲染前为语义节点登记 AST `position.start/end.offset`，并补上隐藏 Frontmatter 的偏移。可逐 UTF-16 单元对应的文本 leaf 使用无视觉样式的 inline span。

浏览器 `caretPositionFromPoint` / `caretRangeFromPoint` 返回文本节点与 DOM offset，`sourcePosition.ts` 将其映射到源码。粗体/链接标签使用其 Text 节点位置，不猜测标记宽度。实体、转义、容器续行等文本不一一对应时回退到当前语义范围；code、math、image、Mermaid 使用块/节点级落点，不映射 SVG 内部节点。

离开编辑记录 source caret + viewport Y，阅读层找到最小包含范围并恢复锚点；进入编辑使用点击 offset + Y，通过 CodeMirror 实际坐标校正同一 Tile 滚动容器。没有滚动比例、固定字符宽度或 marker em 估算。异步图片/图表布局继续校正；用户滚动/点击后停止自动补偿。文档首尾受实际可滚动范围约束。

## Focus-driven layering

活动层参与正常流；另一层为绝对定位、零高度、不可命中、`inert` / `aria-hidden`。两层共享外部 scroll context，通过 scrollContainerRef 支持 Tile 与胶囊 preview-body；CodeMirror 始终 mounted。主动点击新位置替换原选区，键盘/工具栏重入保留原选区。拖选阅读文本不触发编辑，任务/链接/按钮优先处理自身操作。工具栏、输入框、对话框与菜单的内部焦点交接不结束编辑；中文组合输入期间不隐藏编辑器。

## Live presentation and packaged WebViews

`livePresentation.ts` 的 StateField 提供会改变高度的 decorations。鼠标拖选和 composition 期间只映射现有装饰，结束后根据选区重算。`liveWidgets.tsx` 复用安全渲染、图片解析和异步测量；任务 widget 从当前 DOM 映射源码偏移，修改一个任务字符并进入撤销历史。

CodeMirror 动态样式使用页面现有的 Tauri style nonce。胶囊 HTML 提供一个静态样式锚点，打包时由 Tauri 注入 nonce；不放宽 CSP。异步图片插入记录并随 ChangeSet 映射目标位置，完成时检查笔记与编辑器身份。

## Capsule editing host

`useCapsuleEditing` 在编辑入口先申请原生 `{key, generation}` 占用，再读取正式笔记/绑定文件、版本和配置。内部保存使用 updatedAt，外部保存使用 revision 与有序 linked draft 写入。会话内任务修改走编辑器事务。干净正文可接受外部刷新，脏草稿保留并显示恢复入口。外部刷新另按请求序号校验，并在返回时核对会话、输入序号、原目标版本及重载／冻结边界；迟到结果与错误不能覆盖新版本。

原生编辑占用与鼠标 selecting 独立。悬停不更换编辑 owner；关闭、展开、隐藏和全局显隐动作先产生带 requestId 的离开请求，只有匹配会话的 ready 才执行。取消、失败或超时不放行；系统 CloseRequested 同样受守卫保护。纯悬停仍不抢键盘焦点，点击编辑才 set_focus。

显式重新加载合并为同一任务；输入法与图片操作完成后冻结编辑器，读盘及草稿清理成功才共同替换正文和版本，失败恢复输入并保留原会话。离开、退出及更新准备等待同一重载任务，避免输入、重载与保存交叉。

退出和更新安装复用既有准备协议。capsule-preview 参与保存确认，输入法和图片操作完成后冻结输入并保存；取消退出/更新失败后解冻。macOS 退出始终保留已存在的胶囊 WebView 参与者，未编辑时直接 ready。

此实现参考 [PaperTodo 的交互语义与文档边界](https://github.com/snownico0722/PaperTodo/blob/main/doc/DECISIONS.md)，未复制其源码、资源、AvalonEdit visual generators 或实现代码。

## Validation boundary

测试验证 AST 标注、DOM offset、任务单字符补丁、实例身份、跨读写撤销、事件优先级和 IME 门控。DOM 模拟没有真实排版或输入法，不能证明几何与候选框体验；本次已验证结果和剩余真机检查见 [Mac inline editing](MAC_INLINE_EDITING.md)，通用检查见 [MANUAL_ACCEPTANCE](MANUAL_ACCEPTANCE.md)。历史 1.7.2–1.7.4 中的 CodeMirror pseudo-WYSIWYG 说明已由本文件取代。
