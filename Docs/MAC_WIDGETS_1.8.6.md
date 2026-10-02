# Mac 1.8.6：展开控件使用原生Link

用户报告1.8.5展开按钮无效。实际系统日志确认ExpandWidgetNote.perform被调用且返回成功，但没有打开专用链接。Apple文档明确OpenURLIntent仅支持Universal Link，不能使用自定义URL scheme；本项目此前选择了错误API。

删除这一无效Intent，标题右侧使用WidgetKit原生Link打开专用folio://widget-open链接。主应用既有严格校验与旧链接忽略逻辑保留。正文、标题复制和空白点击行为不变，不设置全局widgetURL。复制与翻页仍使用AppIntent。

参考：https://developer.apple.com/documentation/appintents/openurlintent

基本检查包含Swift类型检查、完整扩展编译、Mac构建、签名和版本核对；独立Link的系统点击仍需人工确认，不能以Intent日志成功代替打开成功。

本机已安装1.8.6，结束旧扩展进程后核对主应用、扩展和系统登记版本一致；运行扩展映射来自安装目录。原Markdown哈希未变，个人DMG签名及版本核对通过。云端构建run 37047809154通过。用户确认过1.8.4普通点击不展开；本版右上角Link展开仍待人工确认。
