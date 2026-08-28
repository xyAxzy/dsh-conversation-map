# dsh-conversation-map

Conversation map for DeepSeek Harness web: a live tree of every session in the workspace — subagent lineage, running state, and one-click navigation.

DSH 对话地图：当前工作区全部会话的实时树状图，子代理谱系、运行状态一目了然，点击即跳转。

## Features

- **对话地图**：全部会话按工作区（cwd）分组的实时树状图
- **子代理谱系**：父/子会话关系连线，一眼看清派生链
- **运行状态**：运行中 / 待交互 / 空闲状态点
- **一键导航**：双击卡片跳转会话
- **便签风格**：方格本背景 + 手绘风边框 + 彩色工作区标签
- **可缩放画布**：平移 / 缩放 / 拖拽摆放工作区框

## Install

```bash
dsh plugins add dsh-conversation-map
```

然后重启 `dsh web`，左侧栏底部出现「对话地图」入口。

## Usage

- 点击左下角「对话地图」打开地图 tab
- 双击会话卡片跳转到该会话
- 拖动工作区标题条移动整个工作区，拖角落调整大小
- 点击卡片查看摘要 / 关键结论 / 下一步

## License

MIT
