export const inlineEditingCases: Record<string, string> = {
  paragraph: "普通中文点击测试 English 😀 mixed text\n\n另一段文字测试落点",
  heading:
    "# 一级标题点击测试\n\n## 二级标题点击测试\n\n### 三级标题点击测试\n\n#### 四级标题\n\n##### 五级标题\n\n###### 六级标题\n\n末尾",
  setext: "一级标题测试\n==========\n\n二级标题测试\n----------\n\n末尾",
  emphasis:
    "正文 **粗体文字测试** 和 *斜体文字测试* 与 ~~删除文字测试~~ 以及 ***嵌套文字测试***\n\n末尾",
  list: "- 无序文字测试\n- 第二行\n  - 嵌套文字测试\n\n1. 有序文字测试\n2. 第二项\n\n末尾",
  quote: "> 引用文字测试\n> 第二行\n>\n> > 嵌套引用测试\n\n末尾",
  code: "行内 `const value = 1` 文字测试\n\n```js\nconst value = 42;\nconsole.log(value);\n```\n\n    indented code\n\n末尾",
  task: "- [ ] 未完成任务测试\n- [x] 已完成任务测试\n\n末尾",
  link: '[链接文字测试](https://example.com "title") 和 <https://example.com>\n\n[引用文字测试][id]\n\n[id]: https://example.com\n\n末尾',
  escape: "转义 \\*星号测试\\* 和 &amp;实体测试 与 \\_下划线\\_\n\n末尾",
  wrap:
    "# 标题\n\n" +
    "长段落混合中文 English 😀 点击落点测试，".repeat(20) +
    "\n\n滚动后文字测试\n\n末尾",
  break: "软换行测试\n下一行文字\n\n硬换行测试  \n下一行文字\n\n末尾",
  image:
    '![示例](data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="80" height="30"%3E%3Crect width="80" height="30" fill="green"/%3E%3C/svg%3E)\n\n图片后文字测试\n\n末尾',
  math: "行内 $x^2+y^2$ 公式后文字测试\n\n$$\nx^2 + y^2 = z^2\n$$\n\n块后文字测试\n\n末尾",
  table:
    "| 姓名 | 状态 |\n| --- | --- |\n| 张三 | 完成 |\n| 李四 | 待办 |\n\n表格后文字测试\n\n末尾",
  mermaid: "```mermaid\ngraph LR\n A[开始] --> B[完成]\n```\n\n图表后文字测试\n\n末尾",
  hr: "第一段\n\n---\n\n分割线后文字测试\n\n末尾",
  alert: "> [!NOTE]\n> 提示文字测试\n\n末尾",
  frontmatter: "---\ntitle: demo\ntags: [test]\n---\n\n正文文字测试\n\n末尾",
  html: "<b>HTML文字测试</b>\n\n末尾",
  footnote: "正文文字测试[^1]\n\n[^1]: 脚注文字测试\n\n末尾",
};
