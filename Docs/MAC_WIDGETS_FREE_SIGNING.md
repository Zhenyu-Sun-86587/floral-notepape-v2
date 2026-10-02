# macOS 小组件免费签名实验

2026-10-03，在只有 Command Line Tools、没有完整 Xcode 的 macOS 26.7.1 上实测：

- xtool 1.20.1 的免费 Apple 账户登录成功。
- 通过其开发服务接口取得 Apple Development 证书，证书与本机生成的 RSA 私钥匹配；证书有效期一年。
- 注册本机 Mac 和 Folio 主应用/扩展的 macOS App ID，启用 App Groups，并取得两份 `MAC_APP_DEVELOPMENT` 配置文件。它们只授权已登记的 Mac，有效期 **7 天**。
- 配置文件中的 `com.apple.security.application-groups` 必须包含团队前缀通配授权。第一批未启用 App Groups 的配置文件不能满足权限校验；启用后重新生成，系统日志确认主应用和扩展的权限校验通过。
- 同一证书签名的沙盒 AppKit 测试应用实际完成了 App Group 容器的定位、写入、读回及测试文件删除。
- GitHub Actions 编译扩展，本机签名、嵌入配置文件并安装。签名完整校验通过，PlugInKit 已登记并启用扩展，主应用已写入空的共享快照；原 Markdown 文件哈希一致。

- 用户已在系统图库添加小组件，截图确认桌面实际渲染了“选择一张便签”的占位内容。免费签名、本机无完整 Xcode 的路线已通过这一阶段。

**选笔记、时间线刷新、翻页和复制仍需人工检查。** 系统 `chronod` 在登记阶段记录过清除描述缓存的日志，但实际添加后可以渲染，不能仅凭该日志判定加载失败。

## 辅助工具

xtool 的发行版没有独立的证书创建/导出命令，所以本地辅助命令在固定版本源码上添加。补丁只用于签名实验，不进入应用运行代码，不改 Windows。底层库路径改为解码后的文件路径，避免 `Application Support` 的空格被编码成 `%20` 导致原生库崩溃。

源码来源：<https://github.com/xtool-org/xtool>（MIT），固定标签 `1.20.1`，提交 `916cdffba86c7661e450a98eb76bfad5f824a4d6`。从仓库根目录准备：

```sh
git clone --depth 1 --branch 1.20.1 https://github.com/xtool-org/xtool.git local-build/tools/xtool-source
git -C local-build/tools/xtool-source apply ../../../scripts/xtool-folio-signing.patch
cd local-build/tools/xtool-source
swift build --product xtool -c release -j 4
```

补丁不会读取原版 xtool 专属钥匙串，而是让用户在本机终端登录一次。实验数据保存在 `~/Library/Application Support/FolioSigningExperiment`，目录权限700，私钥与配置文件权限600。创建证书前检查账号下没有已有证书，不撤销证书、配置文件或设备；遇到已有证书时停止。证书请求前先落盘私钥，避免请求失败丢失密钥。配置文件使用唯一名称，不删除旧配置。

免费登录使用 Apple 私有接口，并非 Apple 官方支持的自动化路线。账户验证由用户输入，不在仓库或 CI 中保存账户密码。证书私钥及钥匙串密码不上传 GitHub。

创建证书：

```sh
zsh scripts/create-free-macos-certificate.command
```

已有证书时只更新开发配置文件：

```sh
zsh scripts/create-free-macos-certificate.command --renew-profiles
```

这一步复用证书，并登记/复用本机设备和本项目 App ID，为本项目启用 App Groups；不影响其他应用的能力设置。

## 构建与本机签名

本机构建普通 Folio.app；扩展及 App Intents 元数据由 `.github/workflows/macos-widget-check.yml` 编译，下载对应源码/版本的 artifact。`build-macos-widgets.py` 检查扩展身份、版本、元数据、签名团队、配置文件有效期和 App Group 授权。匹配版本的预编译扩展可在没有完整 Xcode 的本机签名：

```sh
python3 scripts/build-macos-widgets.py \
  --app /path/to/fresh/Folio.app \
  --prebuilt-extension local-build/widget-ci/FolioWidgets.appex \
  --team YOUR_TEAM_ID \
  --identity YOUR_CERTIFICATE_SHA1 \
  --keychain /path/to/dedicated-signing.keychain-db \
  --profiles-dir "$HOME/Library/Application Support/FolioSigningExperiment/group-profiles" \
  --development
```

`--development` 是本机开发实验，会加入调试权限；不能用于正式公证分发。个人测试包包含绑定设备的开发配置文件，不作为通用安装包发布给同学。免费证书、设备授权与正式 Developer ID 分发是不同流程，后者另行处理。

本次仅使用独立测试钥匙串，保留登录钥匙串及其默认身份。为签名临时加入搜索列表，并保存原列表供还原；不设置永久信任例外、不修改系统安全策略，不重置后台活动或 WidgetKit 数据库。

设置步骤：打开笺影主界面 → 齿轮设置 →“macOS 桌面小组件”，勾选允许共享的便签，自动保存；右键已添加的桌面小组件 →“编辑小组件”→“便签”，选择其中一张。多个小组件可分别选择不同便签。

后续人工检查：系统尺寸、不同笔记、保存后的刷新、三档字号、翻页与回到首页、标题/正文/当前页/Markdown复制、空白点击不展开。关闭主窗口后快照仍应可读。配置文件到期后，先更新配置文件，再重新签名、安装应用；仅运行更新配置文件命令不会更新已安装应用。
