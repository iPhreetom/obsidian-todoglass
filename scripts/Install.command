#!/bin/zsh
set -euo pipefail
task_root="${0:A:h}"
if [[ ! -d "$task_root/todoglass" ]]; then
  print '请先完整解压安装包，再运行本文件。'
  read -r '?按 Enter 退出…'
  exit 1
fi
task_vault=$(/usr/bin/osascript -e 'POSIX path of (choose folder with prompt "请选择你的 Obsidian 仓库文件夹（不是 .obsidian 文件夹）")') || exit 0
task_config="${task_vault%/}/.obsidian"
if [[ ! -d "$task_config" ]]; then
  print '这个文件夹没有 .obsidian 配置目录。若使用自定义配置目录，请手动安装。'
  read -r '?按 Enter 退出…'
  exit 1
fi
task_destination="$task_config/plugins/todoglass"
if [[ -e "$task_destination/main.js" ]]; then
  print '发现已安装版本。请先在 Obsidian 中关闭 TodoGlass，再继续更新。'
  read -r '?准备好后按 Enter 继续（Control+C 取消）…'
fi
mkdir -p "$task_destination"
# Copy only release files, preserving existing per-vault settings in data.json.
/usr/bin/ditto "$task_root/todoglass" "$task_destination"
chmod +x "$task_destination/macos/TodoGlass.app/Contents/MacOS/TodoGlass"
print "安装完成：$task_destination"
print '请在 Obsidian → 设置 → 第三方插件中启用 TodoGlass。'
print '如未出现，请重新加载 Obsidian。启用后浮窗会自动显示。'
read -r '?按 Enter 关闭…'
