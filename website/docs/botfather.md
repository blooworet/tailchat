---
id: botfather
title: BotFather 使用指南
sidebar_label: BotFather
---

本页介绍如何在 Tailchat 中通过 BotFather 创建与管理机器人，以及使用 botToken 进行鉴权。

## 快速开始

1. 在客户端搜索并打开与 `@BotFather` 的对话（或在“添加好友”页点击“与 BotFather 对话”）。
2. 发送 `/start` 查看命令帮助。
3. 现在支持交互式引导：直接发送 `/newbot` 不带参数，即可按步骤完成创建。
4. 消息中的斜杠命令可直接点击（如 `/token issue`），会自动填充或一键发送。

## 机器人命令

- `/newbot <username> <nickname> [avatarUrl]`
  - 创建一个插件机器人（pluginBot）。
  - 用户名规则：5–32 位，仅字母/数字/下划线，必须以 `bot` 结尾（大小写不敏感）。
  - 示例：`/newbot MyHelperBot 我的助手 https://example.com/bot.png`
  - 也可直接发送 `/newbot` 按提示逐步输入（用户名→昵称→头像）。

- `/tokens <botUserId>`
  - 查看该机器人现有 token 列表（仅属主可操作）。

- `/token issue <botUserId> [scopesCSV]`
  - 为机器人签发新的 botToken，并返回一次性明文。
  - 示例：`/token issue 64f... message.send,message.read,socket`
  - 缺少参数时，将进入分步引导（动作→机器人ID→scopes）。

- `/token revoke|rotate|suspend|resume <botUserId> <tokenId>`
  - 吊销、旋转、暂停、恢复指定 token。

## 使用 botToken 调用 API/Socket

1. 使用 `openapi.bottoken.login` 以 botToken 换取短期 JWT（含 `btid`）。
2. 使用短期 JWT 访问 API/Socket。服务端会基于 `btid` 支持即时吊销与 scope 校验。

## /start 与私信

- 在与机器人私信中发送 `/start`，平台会分发 `bot.dm.start` 事件给目标机器人；
- 机器人可以基于该事件完成欢迎与引导，并继续与用户交互。
 - 支持 `/cancel` 随时中断当前交互；会话在 10 分钟无操作后过期。

## 管理后台

- 在管理端用户列表中，点击某个机器人用户的 `BotToken` 操作，进入 token 管理页，可签发、旋转、吊销、暂停/恢复、健康检查。
 - 通过 BotFather 创建后的关键步骤，系统消息会附带“下一步推荐命令”，点击即可继续（前端支持斜杠命令点击）。

## 常见问题

参见《BotFather 常见问题（FAQ）》：`/docs/botfather-faq`

## 兼容性说明

- 旧的 `openapi.bot.login` 已弃用并关闭；请迁移到 botToken。
- 用户名已统一为全局唯一的 `@username`，搜索仅支持按用户名精确匹配（不区分大小写）。


## 功能开关（客户端）

- 可点击斜杠命令：默认开启；如需关闭，可在浏览器控制台设置
  - `localStorage['tc_feature_clickable_slash'] = 'false'`
- 输入框 `/` 命令建议：默认开启；如需关闭，可设置
  - `localStorage['tc_feature_slash_suggestion'] = 'false'`


