# TodoGlass

把当天 Obsidian 日记的 **【TODO】** 同步到 macOS 透明置顶浮窗。日记是唯一数据源，浮窗中的操作会直接写回 Markdown。

[English](README.en.md) · [项目主页](https://todoglass-macos.fytmarryzwl.chatgpt.site) · [下载 v1.2.0](https://github.com/iPhreetom/obsidian-todoglass/releases/download/v1.2.0/TodoGlass-1.2.0-macOS.zip) · [全部版本](https://github.com/iPhreetom/obsidian-todoglass/releases) · [MIT 许可证](LICENSE)

## 安装

1. 从 [v1.2.0 发布页](https://github.com/iPhreetom/obsidian-todoglass/releases/tag/v1.2.0)下载并完整解压 **`TodoGlass-1.2.0-macOS.zip`**。
2. 双击 `安装 TodoGlass.command`，选择 Obsidian 仓库文件夹。
3. 在 **Obsidian → 设置 → 第三方插件** 中启用 **TodoGlass**。若未出现，重新加载 Obsidian。

也可以手动将安装包中的整个 `todoglass` 文件夹复制到 `<仓库>/.obsidian/plugins/`。使用自定义配置目录时，将 `.obsidian` 替换为该目录。请保留 `macos` 子目录。

支持 **macOS 13+，Apple Silicon / Intel**。Obsidian 需保持运行。无需 Node、Xcode、辅助功能或录屏权限即可日常使用。原生程序已本机签名，未进行 Apple 公证；源代码附有本机编译脚本。

需要 **Obsidian 桌面版 1.8.7 或更新版本**。目前采用 GitHub Release 完整包安装，尚不能在 Obsidian 社区插件市场中直接搜索安装。发布页的 `main.js` 和 `manifest.json` 是单独构建文件；**只安装这两个文件无法启动浮窗**，还需要完整包内的 `macos/TodoGlass.app`。

这里的本机签名指 **ad hoc 签名**，不是 Apple Developer ID 签名，也没有 Apple 公证。首次打开可能受到 macOS 安全检查限制；如有疑问可查看源码并在本机编译，请勿为安装插件关闭系统整体安全检查。

更新前先在 Obsidian 中关闭 TodoGlass，再运行新版本安装程序；安装程序保留已有的 `data.json` 设置。使用自定义配置目录时请手动安装。卸载时先关闭插件，再删除该配置目录下的 `plugins/todoglass`；日记里的任务会保留。

## 使用

- 浮窗中点击复选框完成任务，再次点击可恢复为待办。
- 双击任务文字或点击铅笔编辑；**⌘ Enter** 保存，**Esc** 取消。
- 父子任务用树状引导线连接，竖线延续到同级分支。点击任务右侧箭头折叠/展开子任务；折叠状态会保留。
- 每条任务旁都预留 **＋** 按钮。点击后直接在该任务下方输入子任务，**⌘ Enter** 添加，**Esc** 取消。输入期间同步刷新会保留草稿和光标位置。
- 点击任务的 **⋯** 选择「待办 / 进行中 / 已完成 / 稍后处理 / 已取消」。
- 底部 **添加一件事** 新增顶级待办，或按 **⌘ N**。
- **已完成 / 已取消** 的任务始终显示在列表底部的「已结束」区域，可随时查看或恢复。这个展示顺序仅作用于浮窗，不移动 Markdown 中的任务，也不改变父子结构。完成父任务只改变该任务，子任务保持各自状态。
- 顶部折叠按钮将整个浮窗收起；拖动顶部可移动，边缘可调整大小。
- 背景默认仅有 12% 的浅色遮罩，不模糊背后的窗口；右上角设置中的「背景不透明度」调到 **0%** 即完全透明，**100%** 为实色背景。文字和层级引导线保持清晰。
- 隐藏浮窗后，可从 macOS 菜单栏的勾选图标恢复，也可运行 Obsidian 命令 **TodoGlass: 显示今日待办浮窗**。
- 点击底部日记路径打开原文。Obsidian 命令可以绑定应用内快捷键。

## 日记格式

默认读取 Obsidian 核心插件「日记」的目录、日期格式和模板，无需重复配置。例如你的设置可为：

```text
目录：Journal
日期格式：YYYY-MM-DD-ddd
```

对应 Markdown：

```markdown
# 【TODO】
- [ ] 写一篇文章
  - [/] 整理思路
  - [ ] 补充案例
- [x] 已完成的一件事

# 【碎碎念】
这里的任务不会进入浮窗。
```

可识别 `TODO`、`【TODO】`、`To-do`、`待办`、`待办事项` 标题，也支持独立一行的 `【TODO】` 或 `**【TODO】**。填写自定义标题后只读取该标题。标题区域包含下级标题，遇到同级或更高标题结束；独立标签遇下一个标签或标题结束。只展示 checklist，不将普通段落或普通项目列表自动转成任务。多行任务的续行保留在原文中，浮窗编辑第一行文字。

支持标准 Markdown 任务和层级缩进：`[ ]` 待办、`[/]` 进行中、`[x]` 完成、`[-]` 取消、`[>]` 延后。其他单字符标记保留，菜单操作后才转换。任务中的链接、日期和 block ID 均按原文保存，编辑时显示原始 Markdown。

今日日记不存在时，浮窗显示空状态；**新增第一条待办时**才创建日记，并使用核心日记模板。支持模板中的 `{{date}}`、`{{date:格式}}`、`{{time}}`、`{{time:格式}}`；不会执行 Templater 脚本。跨午夜自动切换至新一天，不自动搬运历史未完成任务。旧日期的编辑草稿会保留，但保存时拒绝写入并提示刷新。

## 数据与冲突

浮窗每约 0.8 秒从本机获取状态，监听 Obsidian 的文档与编辑事件。打开的编辑文档通过 Editor transaction 修改，后台文件通过 `Vault.process` 原子更新；任务已被别处改动或定位有歧义时拒绝覆盖，显示错误后可取消编辑并刷新。勾选、编辑、新增均不改动 TODO 区域之外的内容。

通信仅使用 `127.0.0.1` 上随机端口和每次运行生成的令牌，不上传日记。浮窗不读取仓库文件，只通过 Obsidian 插件读写今日日记。停止插件或退出 Obsidian 后，浮窗会退出；异常断开时会显示重连状态，持续断开约 15 秒后退出。

日常运行不依赖外部服务，可以离线使用。窗口位置与折叠偏好保存在本机，任务内容仍保存在原日记中。详细边界与漏洞反馈方式见 [SECURITY.md](SECURITY.md)。

## 支持范围与验证

- 运行目标是 macOS 13+；安装包中的原生程序同时包含 arm64 与 x86_64。Windows、Linux、iOS 和 Android 不提供全局浮窗。
- 当前实机验证环境是 **macOS 26.5 / Apple Silicon**。Intel 与 macOS 13 已配置对应编译目标，尚未在这些实机环境完成兼容性验证。
- 自动化测试覆盖 Markdown 读写、冲突保护、本机通信、模拟 Obsidian 编辑流程，以及 jsdom 中的真实浮窗页面交互。模拟 API 与 DOM 测试不能代替所有 Obsidian 版本、macOS 窗口行为、Intel 设备或其他插件组合的实机验证。
- 只联动当天日记中指定的 TODO 区域；不会扫描全仓库任务、自动迁移历史未完成任务，或执行 Templater 脚本。Obsidian 退出后浮窗不能独立编辑日记。

## 开发

开发需要 **Node.js 24**；原生编译和完整打包还需要 macOS 与 Xcode Command Line Tools。在源码目录运行：

```sh
npm ci
npm run typecheck
npm test
npm run build
npm run build:native
npm run package
```

`build:native` 直接调用 `swiftc`，输出包含 arm64 与 x86_64 的 universal AppKit/WKWebView 程序，并进行 ad hoc 签名。`package` 使用 macOS 的 `ditto`，生成 `dist/TodoGlass-1.2.0-macOS.zip` 和对应的 `source.zip`。Ubuntu 可运行类型检查、自动化测试和 JavaScript 插件构建，不能编译或打包原生浮窗。

实现遵循 [Obsidian Vault API](https://docs.obsidian.md/Plugins/Vault) 和 [Editor API](https://docs.obsidian.md/Plugins/Editor/Editor) 的文件修改方式。

## 参与开发与许可

欢迎提交 [Issue 或 Pull Request](https://github.com/iPhreetom/obsidian-todoglass)。构建、验证和发布流程见 [CONTRIBUTING.md](CONTRIBUTING.md)，安全问题见 [SECURITY.md](SECURITY.md)。问题复现请使用虚构日记，删除真实内容、路径与令牌。

项目采用 [MIT 许可证](LICENSE)。第三方依赖及其许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。TodoGlass 是独立项目，与 Obsidian 官方没有隶属关系。
