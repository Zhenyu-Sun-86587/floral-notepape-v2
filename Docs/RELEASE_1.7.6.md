# Hermes Surface 1.7.6 — 完整预览与胶囊末端空间

- 移除悬停预览的 60 行 / 2400 字符硬截断，完整正文交给现有 Markdown 渲染管线；长内容在预览内滚动到底，不再要求展开便签才能看全文。保留有限窗口高度，避免长文超出屏幕。
- 阅读任务改用完整正文相等校验，继续保留 linked revision/conflict 保护。
- 胶囊拖动头与成员按同一原生布局计划的比例分配实际 WebView viewport，不再独立用固定 CSS 像素占位；显式取消 flex 子项的自动最小尺寸，避免末端被裁掉。普通组总占比为 100%，超容量组仍可滚动，单成员占满。
- 不改变组求解、持久化颜色、拖动协议、成员数量或 1.7.5 Editor 架构。

已确认预览截断来自后端硬限制。截图中胶囊裁切的具体运行时 DPI/WebView 缩放组合尚未实测；本次将 DOM 分配绑定到实际 viewport，仍需用户在原环境复测。

## 验证

2 项前端 viewport 分配测试、11 项 Rust capsule 定向测试、lint、TypeScript/Vite 生产构建及 Windows x64 NSIS 打包均通过。GUI 未代测，见 [MANUAL_ACCEPTANCE](MANUAL_ACCEPTANCE.md)。

安装包：Hermes Surface Dev_1.7.6_x64-setup.exe。

SHA-256：1A279D46CBAD953AECF73A5BDF579E71572F1CAE6DC1CF125E88D1649A30E5FD
