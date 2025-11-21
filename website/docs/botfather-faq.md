---
id: botfather-faq
title: BotFather 常见问题（FAQ）
sidebar_label: FAQ
---

## 可点击斜杠命令如何关闭？

客户端默认开启。你可以在浏览器控制台执行：

```
localStorage['tc_feature_clickable_slash'] = 'false'
```

## 输入框的 `/` 命令建议如何关闭？

客户端默认开启。你可以在浏览器控制台执行：

```
localStorage['tc_feature_slash_suggestion'] = 'false'
```

## 分步交互卡住怎么办？

任何阶段发送 `/cancel` 可取消当前操作；会话在 10 分钟无操作后自动过期，可重新 `/start` 开始。

## 为什么提示“操作过于频繁”？

为防止滥用，部分操作受限流保护（例如 `/newbot` 每用户 60s 内最多 3 次）。请稍后再试。

## 为什么我无法操作某个机器人的 token？

只有机器人属主可以签发/旋转/吊销/暂停/恢复该机器人的 token；请确认权限或联系属主。


