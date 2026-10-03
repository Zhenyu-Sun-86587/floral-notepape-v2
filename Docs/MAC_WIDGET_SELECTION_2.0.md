# 2.0.0 小组件选择故障与免费路线调研

2026-10-04，本机 macOS 26.7.1、M4，正式 ad-hoc 2.0.0。

## 已验证事实

- 用户设置 Inbox，桌面仍显示 Today。只读检查系统保存的两份笺影组件配置，选择均为 Inbox；未修改系统配置数据库。
- 私有容器快照包含 Today 和 Inbox，两篇均为真实外部 Markdown；主程序发布与扩展读取成功。
- 原正式二进制以及完整 Xcode 的诊断构建均出现 `linkd` 错误：`Failed to generate bundleIdentity`，`Unable to get teamId from dev.hermes.surface.widgets`。随后扩展报告 App Intents 元数据读取失败。
- 完整 Xcode 诊断日志显示 EntityQuery 默认结果被调用，Provider 取得索引 0；没有按已保存 Inbox 标识成功调用实体解析。默认结果和 Provider 回退叠加掩盖了配置失败。
- 本机 `security find-identity -v -p codesigning` 为 0 个有效身份。不能从本机事实推广为所有 macOS 或所有 ad-hoc 包均如此。

## 已完成的安全修复（开发分支）

实体查询按请求标识顺序返回；默认结果返回 nil，缺失或失效的显式选择不能回退到第一篇。对内部/外部标识、列表重排、空选择和撤销选择加入定向回归，执行通过。正式 WidgetKit 扩展的完整 Xcode 构建检查 [37135901465](https://github.com/Zhenyu-Sun-86587/floral-notepape-v2/actions/runs/37135901465) 通过。

这仅防止显示错误笔记，不代表签名导致的配置失败已恢复。尚未合并或发布新版本。

## 免费方案比较

1. 主应用统一选择一篇，所有组件读取同一配置：简单，但不满足 Today / Inbox 同时独立显示。
2. 主应用设置多个固定编号，使用 StaticConfiguration 与 WidgetBundle：建议优先验证。按稳定笔记 ID 发布编号配置，组件 1 / 2 分别显示指定笔记；同一编号的多个副本共享设置。内部和外部笔记共用既有发布边界，不直接读写原笔记。更新后请求对应 kind 刷新，实际时机由系统调度。该方式绕开 App Intents 的选择参数解析，但不解决所有签名/容器授权限制。
3. SiriKit IntentConfiguration：能提供系统配置界面；独立字符串参数的完整 Xcode 验证组件已构建 [37135888200](https://github.com/Zhenyu-Sun-86587/floral-notepape-v2/actions/runs/37135888200)。未进行真实选项传递验证。要恢复动态笔记下拉列表，通常需要额外 Intents extension 和动态选项处理，复杂度及免费签名可靠性尚未验证。

配置期间日志也涉及按钮类型的元数据读取失败，但这不能证明真实点击无法执行；用户报告按钮可以使用。当前按钮构造时直接赋予 noteKey、page、line 等具体参数，配置选择则需要系统还原 NoteEntity 与实体查询，不能将两条路径等同。现有证据仅支持本机配置读取链路失败，不支持“ad-hoc 下所有 App Intents 不可用”的结论。主应用编号方案应优先保留现有按钮，复制、翻页、待办单独实测后再决定是否修改。只有实际按钮失败时才考虑公开 Link / widgetURL 路线，其代价是唤起应用，不能宣称与系统原地按钮完全等价。多 Link 控件适用于中、大、超大组件；小尺寸需要单独设计，不能偷偷删功能。不得绕过系统身份检查或伪造 Team ID。

## Apple 一手资料

- [StaticConfiguration](https://developer.apple.com/documentation/widgetkit/staticconfiguration)
- [WidgetBundle](https://developer.apple.com/documentation/SwiftUI/WidgetBundle)
- [创建 WidgetKit 扩展](https://developer.apple.com/documentation/widgetkit/creating-a-widget-extension)
- [SiriKit 配置与动态选项 WWDC20](https://developer.apple.com/videos/play/wwdc2020/10194/)
- [小组件交互依赖 App Intents](https://developer.apple.com/documentation/widgetkit/adding-interactivity-to-widgets-and-live-activities)

SiriKit 验证组件在调研时位于 native/tests，仅通过明确 --compile-only --legacy-probe 编译，未进入正式包。用户接受主应用设置方案后，验证组件和专用构建开关已删除。诊断应用不得作为正式交付物。本轮未重置小组件、权限、启动项数据库，未修改真实笔记。实现与升级方式见 [2.0.1 发布说明](RELEASE_2.0.1_MAC.md)。
