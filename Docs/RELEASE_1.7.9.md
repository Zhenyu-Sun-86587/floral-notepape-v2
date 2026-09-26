# Hermes Surface 1.7.9 — 外部文件初始化与同步通知

## 排查结论

本机 Inbox.md、Today.md 的绑定路径均存在，并位于 Syncthing 的 Sync 目录；本地配置与草稿在应用配置目录，不在该同步目录。没有读取或修改服务器配置。

发现两个独立缺陷：

1. load_config 每次读取都写回配置；公共 JSON 写入器固定使用 config.json.tmp。并发窗口或后台配置读取会共用临时文件，一个写入者 rename 后另一个可报 os error 2。外部便签初始化先读配置，因而可在加载正文前留下空白窗口。此代码路径确定存在，但没有历史运行日志证明截图中的具体报错来源。
2. 绑定保存 Windows 扩展路径（带 `\\?\`），watcher 直接比较原始字符串，会漏掉普通路径格式的通知。现在比较时统一扩展路径、UNC、大小写和分隔符，也处理父目录替换事件。原文件缺失时无需 canonicalize。

## 修复

- JSON 写入使用独占 UUID 临时文件，失败清理仅属于本次写入的临时文件；错误携带目标路径。配置未变化时不再写回。
- 内部笔记列表加载失败不再阻断外部正文；初始化错误提示包括配置、正文/草稿或内部便签阶段。
- 草稿读取直接处理 NotFound，消除 exists/read 间隙；损坏草稿明确报告路径，保留原文件。
- 外部正文读写命令移到后台线程，1.7.8 的有限读取重试不阻塞 UI。保留 revision 冲突检查，不自动覆盖外部修改，不把暂时缺失当作空文件。
- Syncthing 临时文件仍排除；绑定 ID、Windows 本地绝对路径、草稿与窗口状态保持本机数据。同步双方的 Markdown 正文通过原绑定读取。

## 验证

171 项 Rust 测试、lint、TypeScript/Vite 生产构建和 Windows x64 NSIS 打包通过，新增 8 线程共 160 次 JSON 写入及 Windows 扩展路径/目录事件回归。界面和真实 server/Windows 同步时序仍由用户验收，见 MANUAL_ACCEPTANCE.md。

安装包：Hermes Surface Dev_1.7.9_x64-setup.exe。
