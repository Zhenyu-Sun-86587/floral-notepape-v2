# Hermes Surface Dev 1.6.0

Windows 收尾版本：完善桌面便签、锁定与贴边收纳，并完成 P8 代码复查和交付记录。

## 下载

- `Hermes Surface Dev_1.6.0_x64-setup.exe`：Windows x64 NSIS 安装包，19,375,727 字节；未签名。
- `SHA256SUMS.txt`：安装包校验和。
- `MAC_HANDOFF.md`：面向 Mac 协作者的实现与验收文档；本次没有 Mac 安装包。

未内嵌完整 WebView2 Runtime，缺少 Runtime 时安装器需联网下载。

## 主要更新

- 收纳色条可拖至左、右、顶部及跨屏，记住收纳位置；展开仍回原便签的位置与尺寸。单击展开、悬停预览、离开收回。
- 阅读/写作在同一便签窗口切换；阅读正文使用普通箭头。
- 锁定时主体鼠标穿透，保留原锁图标位置的解锁入口。
- 普通/置顶便签保留系统阴影；桌面附着用轻微 CSS 阴影，避免 Explorer 子窗口的 DWM 黑边。
- 收纳列表仅读取标题，悬停才读取正文；文件监听空闲阻塞，事件路径去重并限制连续事件合并时长。
- 补齐 Mac 行为对齐路线、源码入口、原生窗口设计约束、两种架构构建与人工验收要求。

## 验证与已知边界

- Windows Release/NSIS 构建、TypeScript、3 项收纳相关 Rust 检查通过；本次新增拖动与阴影视觉仍待用户 GUI 验收。
- Windows 原生 Acrylic 的失焦行为保持系统默认；桌面附着模式不支持 Acrylic。
- 运行内存、CPU、首开延迟没有可信实测，不宣称达到性能指标。
- 应用内重命名、缺失文件重新关联、全局全部收纳入口仍为保留项。
- Mac 尚未构建或验收；应用标识、原位解锁、桌面层和收纳拖动等需按交接文档实现后交付。

Windows 二进制源码基线：[`28217ce855469b0753eb6a157b9c5fce29d2d1da`](https://github.com/Zhenyu-Sun-86587/floral-notepape-v2/commit/28217ce855469b0753eb6a157b9c5fce29d2d1da)。Tag 指向该提交，后续文档补充位于 main。

安装包 SHA-256：`8FF47FFCA7EDF1C0759265BA6BA7FF849BD792E2D7E6740A78926A5EDDFF64E7`。

[P8 复查与完整保留项](https://github.com/Zhenyu-Sun-86587/floral-notepape-v2/blob/main/Docs/P8_FINAL.md) · [Mac 开发交接](https://github.com/Zhenyu-Sun-86587/floral-notepape-v2/blob/main/Docs/MAC_HANDOFF.md) · [上游来源与许可](https://github.com/Zhenyu-Sun-86587/floral-notepape-v2/blob/main/Docs/UPSTREAM.md)
