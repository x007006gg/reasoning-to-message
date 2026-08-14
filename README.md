# 思维链搬运工 (Reasoning to Message)

一个 TauriTavern 第三方扩展：当模型**只输出思维链、正文为空**时，自动把思维链内容搬运到正文，并清空思维链。

## 背景

部分模型会把正文内容也写在思维链（`extra.reasoning`）里，导致最终的回复正文（`mes`）是空白的。本扩展在消息落库后、渲染前检测：

- 助手消息的正文 `mes` 去掉空白后为空
- 同时 `extra.reasoning` 非空

满足条件即把 `extra.reasoning` 的内容写入 `mes`，并清空 `extra.reasoning`（及 `reasoning_signature`），随后自动落盘并重渲染该消息。

## 安装

把本目录放入 TauriTavern 的第三方扩展目录之一：

- **local（推荐）**：`data/default-user/extensions/reasoning-to-message/`
- **global**：`data/extensions/third-party/reasoning-to-message/`

然后在扩展管理界面启用「思维链搬运工 (Reasoning to Message)」。

> 也支持从 Git 仓库安装：`https://github.com/<你的仓库>.git`。

## 配置

扩展面板提供两个开关（默认启用）：

- **启用自动搬运**：关闭后插件不处理任何消息
- **输出调试日志**：把每次搬移的信息打印到浏览器控制台

## 行为说明

- 只在正文**完全为空**（`mes.trim()` 长度为 0）时触发，不处理正文非空的情况
- 只处理助手消息（跳过系统消息、用户消息）
- 搬移后会同步 swipes 快照、清空 reasoning 签名，并调用统一保存队列落盘

## 文件结构

```
reasoning-to-message/
├── manifest.json    # 扩展清单（hooks.activate -> init）
├── index.js         # 核心逻辑：事件挂钩 + 搬移 + 保存/重渲染
├── settings.html    # 设置面板
├── style.css        # 面板样式
└── README.md
```