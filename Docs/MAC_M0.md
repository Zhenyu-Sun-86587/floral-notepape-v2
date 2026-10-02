# Mac M0：隔离与启动基线 — 1.7.10

日期：2026-10-02。Windows 起点：v1.7.9 / `36e4bbb6378504ec282219fdedf2915102b82ecf`。

## 阶段范围

- macOS Bundle ID 改为 `dev.hermes.surface`，产品名为 Hermes Surface Dev。
- 取消 Mac 静态主窗口，沿用按需建窗及现有 Overlay 红绿灯。
- 保留独立配置/数据目录与文件保存实现；补齐 npm lockfile 缺失项，没有主动升级现有依赖。
- 每阶段完成基础检查、生成新的 Mac 安装包并推送 GitHub；主要 GUI 验收交由用户，收到结果后再推进下一阶段。

## 环境与基础检查

macOS 26.7.1 (25G241)，arm64；Node 26.10.0、npm 11.19.1、Rust 1.98.1，Xcode Command Line Tools。

- `npm ci`、前端 TypeScript/生产构建、Mac Release app/dmg 构建通过。
- 6 项窗口路由与保存策略前端测试、oxlint、Rust 格式检查和 git diff 空白检查通过。
- 实查 Info.plist：Bundle ID 为 `dev.hermes.surface`，名称 Hermes Surface Dev，版本 1.7.10，最低 macOS 15.0；Mach-O 为 arm64。
- 隔离目录 `/tmp/hermes-m0-suj6s_hp` 中以 `--silent` 启动，5 秒内未退出；config.json 的 dataDir 指向该目录内 data，测试进程已清理。这不能证明 GUI 不闪、焦点与完整保存行为。
- 安装包：`Hermes Surface Dev_1.7.10_aarch64.dmg`，26,644,897 字节，SHA-256 `189f80e2a0f78483b83572be2c6a583bcfc2c9d5b38f1a2d15046b2c9b22d8f4`。
- 仅二进制链接器 ad-hoc 签名，无 Developer ID / TeamIdentifier，无资源封印，未公证；不能声称 Gatekeeper 安装验收通过。
- Mac 编译有 6 项现有条件编译/未使用代码警告，不影响本阶段构建。

默认配置：`~/Library/Application Support/hermes-surface-dev`；默认内部数据：`~/Library/Application Support/Hermes Surface Dev`。已有配置中的自定义 dataDir 可覆盖默认数据位置。开发环境变量不由 Finder/登录项自动继承。

## 用户反馈与修复

用户反馈 1.7.10 基础使用大体正常，但独立便签无法出现；M0 尚未通过。1.7.11 修复隐藏窗口等待动画帧的显示链路，见 [Mac 修复说明](RELEASE_1.7.11_MAC.md)，图钉闭环仍待复测。

## 用户人工验收（待测）

1. 安装并正常打开，确认标题为 Hermes Surface Dev，主窗红绿灯正常，菜单栏入口可找回主窗。
2. 新建一张内部笔记，写入中文并保存，固定 → 关闭 → 再固定，重复三次，确认内容保留、关闭后没有透明拦截层。
3. 用虚构 Markdown 目录绑定一个文件，固定并编辑，确认保存到原文件；关闭、重新固定后内容保留。使用外部编辑器普通保存和原子替换，观察是否更新。
4. 在同一便签内阅读 → 写作 → Esc/失焦返回阅读，确认位置和尺寸不变；检查中文输入、撤销、任务勾选。
5. 检查首次静默启动没有主窗闪现，配置与数据没有写入原版目录；原版并存、登录项和 WebKit 隔离仍待人工验收。

## 后续阶段与当前边界

M1：日常编辑、原生材质与阴影。M2：菜单栏驻留、静默焦点、窗口层级和原位解锁。M3：安全边缘、收纳拖动、多屏与恢复。M4：发布工作流、双架构和签名/公证。

当前桌面附着与原生胶囊拖动不可用，原生材质没有 Mac 实现。锁定只有主体穿透，尚无 Mac 原位解锁；首轮请不要用锁定作为必测项目，可通过主界面解除锁定。最后窗口关闭、Spaces/Stage Manager、安装卸载与完整冲突交互尚未验收。

首版仅交付 arm64 开发包，不代表 Intel 构建完成。签名与公证信息以产物实查为准；GUI 项保持待测。
