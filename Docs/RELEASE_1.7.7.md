# Hermes Surface 1.7.7 — 悬停预览关闭与性能审查

## 修复与审查结论

- 旧自动关闭仅隐藏窗口，没有使 generation 失效，迟到的 present 可能重新显示预览。关闭现在清除会话并递增 generation；present、hover、关闭通过同一操作锁串行执行。
- owner 切换仅重置 preview_inside，旧 interacting 会阻止后续关闭。新预览会话同时清除选择占用；Windows 原生左键状态补偿窗口外松键丢失 pointerup。
- WebView pointerleave 丢失时原逻辑没有再次检查。活动预览现在共用一个 150ms 原生光标检查任务，完全离开后保留 550ms 间隙宽限；关闭后检查停止。菜单及实际文本拖选仍保留预览。
- 关闭通知携带 generation，前端拒绝已关闭会话的迟到内容；旧关闭通知不能清除新预览。隐藏后卸载 Markdown，停止响应便签变化读取全文。

## 性能改动

- hover 身份校验直接借用状态，不再每次克隆完整 Markdown 正文。
- 鼠标检查只查询胶囊 owner 的窗口标识，不复制组内便签内容。
- 用单个活动期检查任务替代每次 leave 创建的延时关闭任务；没有活动预览时不轮询。
- 窗口高度计算读取最多十行，不再遍历长文全部行。

以上为代码路径与分配量优化，未进行 CPU/内存基准测量；没有声称量化性能提升。审查范围集中在胶囊、预览、事件与 Markdown 渲染调用链。

## 验证

3 项 Rust 预览测试、1 项前端生命周期回归、lint、TypeScript/Vite 生产构建及 Windows x64 NSIS 打包均通过。定向回归覆盖离开宽限、文本选择/菜单占用、隐藏后停止刷新及过期事件隔离。GUI 验收由用户执行，见 [MANUAL_ACCEPTANCE](MANUAL_ACCEPTANCE.md)。Mac 未实测，窗外松键需按 [MAC_HANDOFF](MAC_HANDOFF.md) 复测。

安装包：Hermes Surface Dev_1.7.7_x64-setup.exe。

SHA-256：C07B42914B408071FB5F2FF1071B46409B72646AF290B61D96297F055D575F00
