# Hermes Surface 1.7.3 — Capsule Group / Container Prefix

基线：`9c2d11fbc8511d4fabfa9e6a021976ce35090b7c`。以开始时的当前工作树开发；两份既有未跟踪构建日志保留，不纳入提交。

## 交付变化

- 胶囊几何改为整条 edge 一个 layout authority。solver 输出有序、轴向工作区内、不重叠的 VisualGroups；碰撞后合并再求解，修复 100/101/160 回归。
- 每个视觉组一个 native WebView，drag head 和所有成员属于同一 DOM。颜色/expanded 不参与几何；group 不写入 session persistence。
- registry 复用稳定 runtime identity 和窗口池；成员集合改变先准备隐藏 surface，DOM-ready 后 Windows native batch 切换。整组拖动只移动一个窗口，单成员拖出做明确 presentation handoff；取消/失败恢复保存布局。
- Markdown 分为 inline delimiter、container prefix、rich block。list/task/quote 使用 source-preserving mark 与不占 flow width 的覆盖图形；有序编号保留原文。修复结构前缀 replacement widget 引入的换行参与者，软换行按实际字体前缀宽度对齐正文。
- 保留 focus-driven editing、常驻 CodeMirror/Lezer 单文档、caret/selection、undo、IME 保护、外部最小 ChangeSet。rich block 与 preview optimistic task update 保留。

## 验证

- `npm test`：29 个文件、139 项通过（包含 11 项 container-prefix 与 3 项 sourceDocument 检查）。
- TypeScript `tsc --noEmit` 与前端 production build：通过。
- `cargo test capsule --lib`：9 项通过；覆盖重叠回归、密集边缘、四档 physical scale、真实组窗口三方向边缘映射、identity merge/split、expanded/color 几何隔离及持久颜色。
- `cargo check`：通过。
- Windows Tauri release / NSIS：通过，x64 安装包 19,584,066 bytes；主程序 ProductVersion/FileVersion 为 1.7.3。

安装包：`src-tauri/target/release/bundle/nsis/Hermes Surface Dev_1.7.3_x64-setup.exe`。

SHA-256：`E24203DD46E2D9694C4FDED115D9B0AF646D89E222A18CCBB071F64EF281E6D0`。

Windows GUI、100/125/150/200% DPI 真机、mixed DPI、多屏拔插、Mac 编译/真机均为 **manual verification required**。

Vite 的既有大 chunk 提示不等于构建失败；本轮不顺便重构 bundle。未运行浏览器 E2E。

## 边界

- 超容量时不可能同时固定槽宽且让所有成员在一屏完整可见，因此使用单个有界可滚动 group viewport。成员自身槽位不压缩。
- Windows native batch 是位置/可见性提交边界，DOM-ready 是前端布局确认；WebView2/DWM 首帧观感仍须真机验收，不宣称 compositor 帧级证明或固定 FPS。
- 非 Windows 共享模型与 UI，当前 adapter 仍逐窗 apply；Mac native group drag/原子交接由协作者继续适配，未声称 Mac verified。
- 本轮构建本地 NSIS，提交并推送当前 branch；不创建 PR 或 GitHub Release。

验收详见 [MANUAL_ACCEPTANCE](MANUAL_ACCEPTANCE.md)，架构边界见 [INTERACTION_1.7.3](INTERACTION_1.7.3.md)。
