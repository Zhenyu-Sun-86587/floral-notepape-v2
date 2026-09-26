# Hermes Surface 1.7.3 交互与 authority

## Capsule

`SurfaceSession[] → capsule_layout::solve → CapsuleLayoutPlan → VisualGroup[] → runtime registry → one WebView / group → CapsuleRail`。

- `capsule_layout.rs` 是不依赖平台的纯 axis solver。输入只有 key、normalized desired offset、physical extent/slot/grip/threshold/gap；颜色与展开状态没有几何入口。输出 group axisStart/axisLength 与严格连续的成员槽位（grip + index × slot）。
- 每条边缘从同一 session/monitor snapshot 求解。相邻 desired offset 形成候选组；若 desired layout 或屏幕边界 clamp 后碰撞，合并候选并重新求解。组数量单调减少，终止后满足 `end[i] <= start[i+1]`。
- 超容量输出单个 screen-bounded viewport，完整成员轨道在其中滚动；保留恒定槽长。cross axis 贴物理屏幕边缘，axis 位于 monitor work area。
- `desktop/capsule_groups.rs` 是唯一 native/window snapshot owner。Rust 只在这里把 physical dimension / monitor scale 投影为 local CSS size；React 不猜测 native offset。runtime identity 通过最大成员交集一对一匹配，排序改变保持 identity。窗口 label 是 registry serial，既不编码完整成员集合，也不持久化。
- 内容集合或尺寸改变时在隐藏备用 WebView 准备新 DOM。所有 revision ready 后 Windows UI 线程用一个 DeferWindowPos batch 处理 position/size/show/hide；旧窗口在此前保持可见。ready 超时只触发失败恢复，不作为动画完成条件。池大小有界，清除不用的旧窗口。
- drop 后保存成员 offset 一次，重新执行 solver。grip 移动一个组窗口；单成员超过阈值时交接到一个浮动 surface，原组紧凑收拢。Esc/错误/超时恢复保存的 session 布局。采样只在拖动期间，非全局 polling。
- CSS transition/WAAPI 只负责内部展开反馈、同 DOM 成员位移；native motion 不伪称动画。合并/拆分优先正确交接，无固定 sleep 的动画完成判定。
- preview/menu 按 registry 成员归属验证。A→B 在同一 nav 内不先发送 A leave，复用原 preview owner/generation 与乐观 task 保存逻辑。

## Markdown

- `SourceEditor` 继续拥有 persistent EditorView 与唯一 Markdown 文档；inline delimiter 可折叠，rich block 保留原 renderer。
- `containerPrefix.ts` 仅消费 Lezer 的 ListMark/TaskMarker/QuoteMark 及其 ancestry；不做第二套 Markdown grammar。仅对已知 marker 后的空格进行有界扫描。
- container prefix 使用 Decoration.mark 保留 source marker、空白和 source offset。有序编号直接显示；bullet/quote/task 以绝对定位伪元素覆盖透明源码，不增加 flow width。task 所属 bullet 透明，避免双 marker。
- active line 仅切换 slot 视觉类，前缀 range 与源码不变。checkbox 命中读取 data-task-offset，更新唯一文档的一字符状态；正文命中继续由 CodeMirror posAtCoords 负责。
- 可见行通过完整源码 prefix Range 测量实际字体宽度，设置等量 padding 和负 text-indent：首行原点不变，软换行起点为正文列。composition 期间停止测量写入，presentation field 只映射已有 decorations。
- 策略测试证明范围/源码/行数不变、ordered marker 保留、task 偏移稳定；真实 Chromium/WebKit 换行、caret/IME 和首帧仍属于人工验收。

## 参考与独立实现

研究了 PaperTodo 的 [AGENTS](https://github.com/snownico0722/PaperTodo/blob/main/AGENTS.md)、AppController.ArrangeDeepCapsules、EdgeCapsuleModel、EdgeCapsulePlacement/Interaction、controller/window VisualTransaction、QueueCoordinator/Geometry，以及 MarkdownSemanticPresentation 的 MarkerSlots/Lists/Collapse、MarkdownTextBox 和 [D-019/D-026/D-030](https://github.com/snownico0722/PaperTodo/blob/main/doc/DECISIONS.md)。

只采用 single layout authority、stable slot geometry、统一 group presentation、single source document 与 structural prefix 独立策略这些原则。没有复制源码、资产、WPF/DComp 或 implementation-specific code。PaperTodo AGENTS 是参考材料，不作为 Hermes 工作区指令执行。
