# macOS 开发交接：还原 Windows 1.6.0 的便签体验

## 0. 基线与完成标准

- 仓库：`Zhenyu-Sun-86587/floral-notepape-v2`。Windows 行为基线为 `v1.6.0`，源码提交 `28217ce855469b0753eb6a157b9c5fce29d2d1da`。从最新 `main` 开发可获得本文后续修订；记录实际开发 SHA。
- Windows 安装包与说明：[v1.6.0 Release](https://github.com/Zhenyu-Sun-86587/floral-notepape-v2/releases/tag/v1.6.0)。整体状态：[P8_FINAL.md](P8_FINAL.md)。原始上游与许可证：[UPSTREAM.md](UPSTREAM.md)。
- 本文是**待实现任务及验收契约**，不是 Mac 已完成声明。本轮只在 Windows 核对源码与补文档，未构建 Mac，也未在 Mac 操作 GUI。
- 用户目标：内部笔记和外部 Markdown 都可作为桌面便签；同窗读写、原位 pin 开关、少量阴影、原生材质、锁定穿透但可原位解锁、贴边收纳拖动、自启与快捷键恢复。
- 保持共有 UI、数据格式和主要交互；系统快捷键、窗口层级、菜单栏/刘海屏等差异明确记录。不要通过仅改控件文案/显示状态来冒充原生能力。
- 自动测试只做改动相关的必要检查；GUI 由 Mac 协作者人工完成，不以编译成功代替验收。复杂平台代码补必要中文注释。

## 1. 先处理已核实的差异

| 能力         | 1.6.0 源码现状                                                                                           | Mac 必须补齐                                                                                                          |
| ------------ | -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 应用身份     | `tauri.macos.conf.json` 覆盖为上游 `com.floral-notepaper.app`，静态主窗标题仍为花笺                      | 使用 fork 的 `dev.hermes.surface`、Hermes Surface Dev；核对最终 Info.plist、登录项、WebKit 存储身份，避免与原版碰撞。 |
| 数据隔离     | `services/notes.rs` 已使用 `HERMES_SURFACE_CONFIG_DIR` / `HERMES_SURFACE_DATA_DIR`，不再自动扫描迁移原版 | 不必重写存储层；先核对实际落盘位置与现有配置覆盖，再使用虚构目录验证。                                                |
| 静默启动     | 通用启动代码支持 `--silent`，但 Mac 配置仍预先创建主 WebView                                             | 清除静态主窗配置，沿用 `show_main_window` 按需创建及已有红绿灯设置；核对首次自启不闪主窗。                            |
| 最后窗口关闭 | `lib.rs` 的无窗口隐式退出保护只在 Windows 分支                                                           | 实测并补齐 Mac 菜单栏驻留、Dock 重开、快捷键找回；显式退出仍应保存并退出。                                            |
| 原生材质     | `set_native_material` 的非 Windows 分支直接返回 false                                                    | 实现 Mac 原生材质及状态回报，保留主题透明度，不用 CSS 模糊伪装桌面磨砂。                                              |
| 桌面层       | 后端在非 Windows 拒绝 `desktopAttached`，前端也灰显                                                      | 用独立 Mac 原生实现评估桌面层；普通、置顶、桌面层三者行为必须可区分。                                                 |
| 锁定/解锁    | 整窗穿透共用；原生解锁覆盖层、DOM 坐标上报和锁定时保留按钮均仅 Windows                                   | 补原位解锁入口及坐标转换。不能把整窗穿透后不可点击的 Web 按钮当解锁入口。                                             |
| 色条拖动     | 左/右/顶部渲染已共有；`CapsuleRail` 与 `drag_capsule` 的拖动路径限定 Windows                             | Mac 原生拖动/松手判定、屏边吸附、跨屏、取消、保存；实现完成后再解除前端平台限制。                                     |
| 收纳预览     | 共有独立 rail + 共享 preview WebView、generation 防止过时预览、按需正文                                  | 验证 WKWebView 首次加载、透明背景、不抢焦点与生命周期；保留小入口，不回退为大块常驻面板。                             |
| 发布         | 上游 `release.yml` 的校验任务限制 owner=Achilng，其他流程还有原版产物路径                                | 另建 fork 专用 Mac 工作流；不要仅去掉 owner 判断就复用上游签名/商店发布链。                                           |

## 2. 必须保持的交互契约

### 2.1 文件、pin 与同窗读写

- “导入 Markdown”创建应用内副本；“绑定目录/外部文件”直接读写原文件。不要混为一套含糊入口。
- 内部会话键 `note:<uuid>`，外部为 `linked:<uuid>`；对应窗口 `tile-<id>`、`tile-linked-<id>`。外部便签不得按内部笔记 ID 查询。
- 主界面 pin 开启已存在便签时切换关闭；便签关闭后，后续 pin/快捷键仍能再次创建。关闭走保存及真实窗口销毁，不留下透明、不可见但拦截桌面的窗口。
- 阅读/写作切换留在**同一窗口、同一位置、同一外部尺寸**。写作可以显示 Markdown 原文，不要求所见即所得，也不再跳到另一编辑小窗。
- 阅读正文为普通箭头；链接/工具按钮可用手形；写作输入区为文本指针。锁定之前先处理未保存内容。
- 阅读态任务勾选继续只修改对应源标记，保留 BOM、换行和 Frontmatter。复杂 Markdown、图片及安全过滤直接复用共有代码。
- 不在本轮 Mac 对齐时顺手承诺 Windows 尚未完成的重命名、缺失文件重新关联、全部收纳入口，见 P8 保留项。

### 2.2 窗口模式、阴影与材质

| 模式/状态 | 期望行为                                                                                                        |
| --------- | --------------------------------------------------------------------------------------------------------------- |
| 普通      | 可被其他普通应用盖住；关闭可再次打开。                                                                          |
| 置顶      | 普通应用前方可见；不抢焦点，不承诺覆盖系统安全界面。                                                            |
| 桌面层    | 像桌面便签随桌面呈现，普通应用可以覆盖；使用 macOS“显示桌面”时仍可找到。Spaces/Stage Manager 的支持范围需明确。 |
| 写作      | 保留窗口外框；如桌面层不适合键盘输入，临时提到可编辑层，结束后恢复原模式。                                      |
| 锁定      | 保留正文可见，临时置顶；主体、边角、关闭/编辑/收纳按钮均不能拦截下方应用，只有锁图标可解锁。解锁恢复之前模式。  |

外观要求：轻微阴影用于区分白色背景，不能露出矩形底层、黑边或多余原生标题栏。正文不能因透明度一起变淡；主界面正文保持可读，边栏/标题区可透出原生材质。用户已撤回“失焦仍强制保持模糊”的要求，Mac 也遵循系统材质的正常聚焦/失焦策略，不加周期性强制激活或全屏截图模糊。

Mac 材质建议先通过 Tauri 支持的原生 effects / AppKit `NSVisualEffectView` 试验可行方案，再决定小范围适配。不要把“API 返回成功”记成“视觉已通过”。原生背景材质与网页背景 alpha 必须同时核对；辅助功能减少透明度时应可读且状态真实。[Apple 材质入口](https://developer.apple.com/documentation/appkit/nsvisualeffectview)、[窗口背后混合模式](https://developer.apple.com/documentation/appkit/nsvisualeffectview/blendingmode-swift.enum/behindwindow)。

### 2.3 原位解锁是验收重点

1. 沿用已有闭锁图形及其尺寸、颜色、悬停样式，不新增“解锁”文字按钮，也不在锁定瞬间位移。
2. 复用 `surface_unlock_button_bounds` 的 DOM 矩形和 viewport 参数。矩形是 CSS 像素；转换经过 WebView 客户区 → NSWindow/AppKit 坐标 → 所在屏幕，集中处理 Retina 与 Y 轴方向。不要用整屏高度硬翻转所有副屏坐标。
3. 可评估原生小型非激活 panel 作为唯一可交互覆盖层，不为这个按钮再创建完整 WebView。主体整窗穿透，覆盖层只负责锁图标区域；不以全局鼠标事件截获普通应用操作。
4. 覆盖层随窗口移动、尺寸、缩放、层级和 Spaces 变化同步，正文窗销毁/隐藏/退出时一并清理。后台窗口不应因刷新按钮而抢焦点。
5. 清理阶段必须覆盖拖动取消、便签收纳、显示/隐藏快捷键、关闭最后窗口。主界面“解除锁定”作为备用入口继续保留。
6. `NotePad.tsx` 中 DOM 上报、锁定后显示工具区/缩放柄有多处 Windows 判断；后端实现完成后按能力解除对应限制，不能只修 Rust。

这里的 panel/坐标策略为实现建议，需 Mac 实测。[NSPanel](https://developer.apple.com/documentation/appkit/nspanel)、[鼠标事件忽略接口](https://developer.apple.com/documentation/appkit/nswindow/ignoresmouseevents) 是原生调研入口。

### 2.4 贴边收纳

- 松手吸附到最近的左、右或上方边缘；常态色条厚度 8 逻辑像素，每项长 32、间隔 8。同屏同边共用轨道；目前按标题排序，不承诺拖动重排。
- 单击恢复，拖动不再附带一次恢复。设拖动阈值；Esc、窗口销毁和鼠标事件中断可取消。不使用永不停止的轮询或持锁等待主线程。
- 悬停约 90ms 显示屏内预览；离开约 220ms 收起，为进入卡片保留间隙。轨道不随悬停变宽或移动，不显示浏览器默认 tooltip。
- 共享预览按需读取正文，最多 60 行/2400 字符；预览只有轻量标题/列表，不加载完整 Mermaid。显示数据后再呈现窗口，generation 过期请求不得覆盖新预览。
- `capsuleMonitor` / `capsuleOffset` 独立于 `expandedBounds`。拖动收纳条不能改变便签展开的位置与尺寸；同边合并规则沿用 Windows。
- Mac 顶部有系统菜单栏/刘海，不能机械套用 Windows 全屏物理边缘。以实际可命中的屏幕安全区域确定顶部位置，避免覆盖菜单操作；如只能贴菜单栏下缘，明确展示并记录为平台差异。左/右避开 Dock 冲突也应有一致规则。
- 跨屏/Retina 重新换算并限位；拔屏后恢复可触及位置，清理旧轨道。普通关闭是 `hidden`，主动收纳是 `stored`，两者不可互换。

### 2.5 自启、快捷键、退出

- `startupBehavior`: `hidden` / `restoreLast` / `expanded`；`presentation`: `hidden` / `stored` / `expanded`。会话存在本机配置中，不写入共享 Markdown 或同步 Windows 绝对路径。
- 自启带 `--silent`；正文准备好才显示所需窗口。无需要恢复的便签时只驻留菜单栏，不闪主窗、不抢走当前编辑器焦点。
- 不要在隐式“最后一个窗口没了”时杀掉菜单栏/快捷键；显式“退出”则完成保存/草稿处理并终止，不留下解锁 panel 或后台采样任务。
- 应用级打开列表/显示隐藏/新建与单便签快捷键必须分清；冲突可见、失败保留旧键、不重复注册。Mac 使用系统惯用修饰键及真实键盘布局，不要把用户的 Ctrl+/ 擅自改成固定默认键。
- Dock 重开、菜单栏点击和 Finder 文件打开要汇入相同窗口/保存状态逻辑。已有 `Reopen`、菜单、LaunchAgent 代码可复用；当前非 Windows `show_silent_surface` 只是 `show()`，必须验证是否激活前台。
- 复核 `NSWindow.CollectionBehavior`、应用 activation policy 和全屏辅助窗策略，不强制让每张便签跨所有 Spaces。具体原生方案以 Mac 实验为准。[Apple 窗口行为](https://developer.apple.com/documentation/appkit/nswindow/collectionbehavior-swift.struct)、[Tauri 自启](https://v2.tauri.app/plugin/autostart/)。

## 3. 源码导航与修改顺序

| 位置                                                                      | 职责/检查入口                                                                                                                                                           |
| ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src-tauri/tauri.macos.conf.json`、`tauri.conf.json`                      | 合并后的身份、窗口清单、最低 macOS 15.0、透明窗口及打包。                                                                                                               |
| `src-tauri/src/services/notes.rs`                                         | 配置/数据目录、内部文件与保存；现有独立环境变量已可用。                                                                                                                 |
| `src-tauri/src/linked.rs`、`linked_watcher.rs`                            | 绑定、revision/草稿、原子写入、事件合并、目录扫描。Mac 再检查大小写敏感卷、Unicode 文件名和编辑器原子替换。                                                             |
| `src-tauri/src/surface_sessions.rs`                                       | 会话枚举、展开坐标、独立收纳位置、默认值与兼容。                                                                                                                        |
| `src-tauri/src/desktop.rs`                                                | `setup_desktop` / `restore_silent_sessions` / `show_silent_surface` / `apply_surface_window_mode` / `set_surface_edit_mode` / `drag_capsule` / `sync_capsule_windows`。 |
| `src-tauri/src/lib.rs`                                                    | IPC 注册、`set_native_material`、`surface_unlock_button_bounds`、`ExitRequested` / `Reopen`。                                                                           |
| `src-tauri/src/lock_overlay.rs`、`desktop_attachment.rs`                  | Windows 行为参考，不能把 HWND/Explorer 代码移植为 Mac 实现；建议单独建 Mac 模块。                                                                                       |
| `src/components/NotePad.tsx`、`Tile.tsx`                                  | 保存、同窗编辑、pin 关闭、锁图标矩形、光标与工具区。                                                                                                                    |
| `src/components/SurfaceSessionControls.tsx`                               | 窗口模式、自启、快捷键、收纳边设置及平台限制。                                                                                                                          |
| `src/components/CapsuleRail.tsx`、`CapsulePreview.tsx`、`src/capsule.css` | 拖动与单击区分、悬停时序、轻量预览、顶部布局。                                                                                                                          |
| `src/features/settings/nativeMaterial.ts`、`theme.ts`、`src/App.css`      | 材质反馈、主题 token 与透明背景/圆角/阴影。Windows `data-native-corner` 规则不能直接套 Mac。                                                                            |
| `src-tauri/capabilities/capsules.json`                                    | 轨道/预览最小事件权限；新命令/窗口仅开放实际需要的权限。                                                                                                                |

建议分五个可验收里程碑，不需要重做 Windows 已完成业务：

1. **M0 隔离可运行**：修应用身份、取消静态主窗、校验独立路径；本机编译和最小内部/外部 pin 闭环。
2. **M1 日常编辑可靠**：关闭真销毁、原位重开、同窗读写、原生材质与阴影；确认输入法组合输入、任务写回和冲突保留。
3. **M2 原生窗口行为**：菜单栏驻留、不抢焦点自启、普通/置顶/桌面层、原位锁定解锁；桌面层尚不可用时保持明确禁用，不能悄悄降成普通窗口。
4. **M3 收纳对齐**：左右顶部安全边缘、拖放、跨屏、预览、快捷键、显示隐藏和持久恢复。
5. **M4 发布**：两种架构构建产物、按相关场景人工验收、同口径资源记录、签名/公证状态与已知差异。

线程约束：文件 I/O 和会话更新可在工作线程，AppKit 对象操作转到主线程。不要把 Windows 的“后台建 WebView”经验照搬成“所有 AppKit 都放后台”。沿用 Tauri 调度入口，避免持有 `CAPSULE_OPERATIONS` 等锁同步等待 UI，而 UI 又反向等待同一把锁。

## 4. Mac 首次启动与构建（PowerShell 7）

准备 Mac、Xcode Command Line Tools、Node/npm、Rust 和 PowerShell 7；按 lockfile 安装，不主动升级核心依赖。选择满足仓库依赖要求的 Node/Rust 版本，记录 `node --version`、`rustc --version`、macOS 版本/芯片。以下代码均在 **Mac 的 pwsh**、仓库根目录执行，Windows 端不执行。若 native 命令失败立即停止，不能继续用旧产物作验收。

**先手动修改 Mac 覆盖配置**：`identifier` 使用 `dev.hermes.surface`，`app.windows` 改为空列表；保留必要的平台设置。核对动态主窗口路径已保留 Overlay 红绿灯；不要将主界面标题栏套到无边框便签。

数据路径源码预期（最终以实际打印/落盘为准）：默认配置在 `~/Library/Application Support/hermes-surface-dev`，内部数据在 `~/Library/Application Support/Hermes Surface Dev`。配置里的自定义 `dataDir` 可覆盖默认。WebKit/登录项身份另外核对，不等同于这两个目录。`config.json`、`surface-sessions.json`、`linked-files.json`、`linked-drafts/` 都是本机状态。

开发环境与虚构文件：

```powershell
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
xcode-select -p
node --version
rustc --version
npm ci
$macTestRoot = Join-Path ([Environment]::GetFolderPath('UserProfile')) 'HermesSurface-Mac-Sandbox'
$env:HERMES_SURFACE_CONFIG_DIR = Join-Path $macTestRoot 'config'
$env:HERMES_SURFACE_DATA_DIR = Join-Path $macTestRoot 'data'
$sampleDir = Join-Path $macTestRoot 'markdown'
New-Item -ItemType Directory -Path $sampleDir -Force | Out-Null
$sampleFile = Join-Path $sampleDir 'Mac-Parity.md'
if (!(Test-Path -LiteralPath $sampleFile)) {
    @('# Mac 测试', '', '中文输入与 Emoji 🙂', '', '- [ ] 第一个任务', '- [ ] 第二个任务') |
        Set-Content -LiteralPath $sampleFile -Encoding UTF8
}
npm run tauri dev
```

这两个环境变量只影响当前 shell 及子进程。Finder 启动和 LaunchAgent 自启**不会自然继承**，因此自启验收前仍须确认应用身份与默认目录已经隔离。不能因为开发时设置过环境变量就直接操作原版目录。

本机架构 Release 构建，先完成隔离修改再执行：

```powershell
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
npm run tauri build -- --bundles app,dmg
```

显式目标构建：Apple Silicon 用 `aarch64-apple-darwin`，Intel 用 `x86_64-apple-darwin`。分别在对应架构 Mac runner 构建最便于后续原生验证；不要求 Windows 交叉编译。针对某个目标示例：

```powershell
$ErrorActionPreference = 'Stop'
$PSNativeCommandUseErrorActionPreference = $true
$macTarget = 'aarch64-apple-darwin'
rustup target add $macTarget
npm run tauri build -- --target $macTarget --bundles app,dmg
Get-ChildItem -LiteralPath "src-tauri/target/$macTarget/release/bundle" -Recurse -Filter '*.dmg'
```

Tauri 会合并 `tauri.macos.conf.json`；构建后核对 `.app/Contents/Info.plist` 的 `CFBundleIdentifier`/名称/版本以及 `Contents/MacOS/hermes-surface-dev`，不能只看根配置。可按改动范围额外运行 `cargo test --manifest-path "src-tauri/Cargo.toml" --lib capsule_`，不要每改一个样式就重跑所有测试。

## 5. 最小人工验收与交付证据

每项记录 `通过/失败/未测/未实现`，并写 macOS/芯片/缩放/模式；失败附最短操作和截图或短录像。不要把“未测”改成“通过”。

| 编号 | 操作与应有结果                                                                                              |
| ---- | ----------------------------------------------------------------------------------------------------------- |
| MC01 | 原版与 fork 并存；fork 首次启动不读写原版目录，登录项和单实例也互不干扰。                                   |
| MC02 | 内部、外部 MD 分别 pin→关闭→再 pin，重复 3 次；无透明拦截层，内容仍在原文件。                               |
| MC03 | 阅读→写作→保存/返回阅读，外部窗口尺寸/位置不变；中文输入、撤销、任务勾选正确。                              |
| MC04 | 原生材质、深浅主题与轻微阴影；普通/置顶/桌面层无黑角、直角底板；失焦遵从系统。                              |
| MC05 | 锁定时原按钮位置不跳；正文/其他按钮穿透到下方应用，唯一锁图标仍可解锁，原模式恢复。                         |
| MC06 | 拖色条到左/右/顶部、跨屏、Esc；松手吸附且不会误展开，单击正常展开，重开记住收纳位置。                       |
| MC07 | 轨道与预览往返、离开收回、首次加载不闪；展开后仍是原便签尺寸/位置。                                         |
| MC08 | 静默登录自启、关闭最后一窗、单便签与应用快捷键、Dock/菜单栏找回、显式退出；不抢焦点、不意外退出。           |
| MC09 | 外部编辑器普通保存和原子替换，目标便签更新；有本地未保存内容时保留冲突选择/草稿。                           |
| MC10 | 多屏/Retina/拔屏、菜单栏/Dock/刘海屏、显示桌面、Spaces、全屏应用、Stage Manager；记录桌面层与置顶支持边界。 |
| MC11 | 更新安装与卸载不删外部 MD；已签名/未签名、公证情况与安装体验一致。                                          |

最小首轮优先 MC01–MC03、MC05–MC08；原生层修改后补相关 MC04/MC10。收尾资源仅做少量同口径采样：0/1/3 张便签、3 张收纳、主界面关闭、完全退出；可再看 10 次开关是否累计窗口/监听器。统计本应用和可确认属于它的 WebKit 辅助进程，不把所有 `com.apple.WebKit.*` 都算进去；Mac 内存口径独立列出，不与 Windows Working Set/Private Bytes 混用。首开延迟无法可靠测就标未测。

验收报告模板：

```text
源码 SHA / 版本：
macOS / 芯片 / 屏幕与缩放：
配置路径 / 数据路径 / Bundle ID：
产物名称、架构、字节数、SHA-256：
签名 identity / 公证状态：
MC01–MC11 结果及失败复现：
普通/置顶/桌面层 + Spaces/Stage Manager 的支持范围：
未实现项 / 未测项：
资源采样口径和数据：
```

## 6. Mac CI 与 Release

- 新增 fork 专用 workflow，先 `workflow_dispatch` 构建 artifact，验证后再选择是否随 tag 发布。设置实际 fork owner 和最小权限，不沿用原作者私有证书、MirrorChyan、SignPath 或商店账号。
- 每种架构执行 `npm ci`、锁定 Cargo 依赖、Release `.app/.dmg` 构建，上传产物和校验和；精确记录源码 SHA。CI runner 标签按届时 GitHub 可用架构核对，不能仅靠目标名声称做过原生运行测试。
- 第一版 Mac 产物可标为开发/未公证版本，但不能称可无提示安装。正式面向外部分发使用协作者自己的 Developer ID 与公证配置；凭据放仓库 Secrets，不写进文档或命令日志。[Tauri 签名与公证](https://v2.tauri.app/distribute/sign/macos/)。
- 当前 `macOSPrivateApi: true` 与透明窗口路径需单独评估 App Store 合规；先完成直接 DMG 分发，不承诺 App Store 支持。[Tauri 配置](https://v2.tauri.app/reference/config/)。
- Windows v1.6.0 已有固定产物来源；Mac 完成后使用新的补丁/版本 Release，并附平台说明，不覆盖现有 Windows 附件伪装为同一构建。
- 交付结束更新 `Docs/STATUS.md`、本文和验收报告。只有编译证据时写“Mac 构建通过”，有人工结果后才逐项写“体验对齐”。
