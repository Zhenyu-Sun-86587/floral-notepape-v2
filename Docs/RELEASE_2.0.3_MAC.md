# 笺影 Mac 2.0.3：后台展开与轻量模式

基线 main `6061c78`，本机安装 2.0.2。小组件右上角原来使用 Link，系统按普通应用链接激活 Folio，触发主窗 Reopen，出现主界面及 Dock 图标。改用与待办按钮相同的基本类型 App Intent 参数，先原子排队，再在宿主未运行时以 `--silent`、`activates=false` 唤醒；宿主校验共享许可、编号当前绑定及稳定 ID，只打开对应内部便签或外部 Markdown。主界面已由用户主动打开时保留其状态。

macOS 设置增加可选轻量模式，默认关闭以保留现有启动习惯。启用后启动不创建主界面；关闭主界面会等待设置队列和当前笔记保存确认，再释放主 WebView 并回到菜单栏。菜单栏「打开主界面」仍可随时打开列表/设置；显式 Finder 文件打开保留原流程。便签、胶囊、小组件、快捷键、监听和同步保留。原基线空白便签池容量已为 0，本轮不重复计入优化；主界面重新创建可能稍慢。

保存失败或超时保留主界面；关闭期间重新打开会取消关闭，销毁已提交时排队重建。退出请求等待全部文档，包含内部和外部便签，沿用 2.0.2 保存确认；不通过强制退出节省开销。Mac 模式和原生处理均在独立模块及平台编译条件内，Windows 保持现有行为。

性能结论限于代码路径：减少主界面 WebView 常驻，无新增空闲轮询。尚未测 CPU、RSS、GPU 或能耗，不给出整体性能百分比。签名仍为 ad-hoc、私有容器路线，不保证跨升级免授权或跨机器全部可用。

## 验证与交付

- 正式源码 `b8f15ddde73efa8d8b00e82cbdd5987aa98d4a1c` 的 [完整 Xcode Mac 构建](https://github.com/Zhenyu-Sun-86587/floral-notepape-v2/actions/runs/37186382446) 与 [Windows 兼容检查](https://github.com/Zhenyu-Sun-86587/floral-notepape-v2/actions/runs/37186384598)通过。前端、Rust、Swift 回归、生产 WidgetKit 配置构造、App Intents 元数据、严格签名与打包完成。早期包含重复预热判断的候选构建已取消，未分发。
- DMG `Folio_2.0.3_aarch64.dmg`，SHA-256：`3f02c37071396cc0c51271fe74f9b08f9fc131f871281e6fd5533977fa9696a2`。Actions ZIP SHA-256 `b4102794a96c1456e27f7c2ae8dcde834c7badf78ca15568ab806d774a669729` 校验通过。主程序 arm64，扩展 arm64/x86_64；身份、版本、严格签名和扩展元数据验证通过，无临时脚本或开发描述文件。
- 2026-10-04 安装到 `/Applications/Folio.app`。旧主程序正常保存退出，只终止旧扩展进程；替换时 15 项受保护文件校验保持。测试后原设置逐字节恢复，真实内部存储、外部 Markdown、绑定、共享许可、编号配置保持；版本状态及会话展示状态允许随升级/展开变化。完整旧应用和数据恢复备份留在本机，不分发。
- Apple M4、16 GB、macOS 26.7.1。以真实已分配的 Inbox/Today 外部 Markdown 检查私有容器操作队列：宿主未运行时静默启动消费操作、已驻留时消费第二次操作，均打开目标便签、没有主窗，NSRunningApplication.activationPolicy 为 Accessory。此为真实宿主链路；桌面系统按钮未能由当前界面工具直接定位，不能标记按钮点击通过。
- 临时通过界面开启轻量模式：设置实际持久化，关闭主窗后便签保留、策略转 Accessory；正常退出后用普通启动验证无主窗、后台驻留，随后恢复原偏好并静默运行。当前没有内部笔记，未创建虚构真实存储内容；内部路由由静态审查及原有回归覆盖，内部便签界面仍待验收。
- 生命周期通过 Tauri 注销主窗口后执行清理。WindowServer 的 optionAll 列表仍记录关闭后不可见的原生窗口，故不能用总窗口数当作 WebView 释放或 RSS 改善的量化证明。没有 CPU/RSS/GPU/能耗持续采样。人工验收重点：主程序退出/后台驻留时分别展开内部和外部便签；Dock 不出现；轻量模式重启、主界面打开/关闭和胶囊操作；未保存长文与外部冲突时关闭；复制/翻页/待办及四个编号回归。

系统启动选项说明：[Apple NSWorkspace.OpenConfiguration](https://developer.apple.com/documentation/appkit/nsworkspace/openconfiguration)。

- 已合并并推送 main `877c16b9d8a088f24749d93361130341026ccd7f`，应用源码与正式打包提交一致。[GitHub 2.0.3 发布](https://github.com/Zhenyu-Sun-86587/floral-notepape-v2/releases/tag/mac-v2.0.3) 提供 DMG、校验清单、构建信息与安装说明。远端四项资产大小及 SHA-256 与本机逐项核对后发布。重复 PR 检查及合并后相同源码的自动 Mac 构建已取消，不将取消标记为通过。
