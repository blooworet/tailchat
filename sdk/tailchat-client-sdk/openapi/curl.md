---

# 组合示例：Reply Keyboard 与 Inline Actions

> 下列示例展示同时使用 `meta.replyKeyboard` 与 `meta.inlineActions` 的常见组合。

## A) RK（按钮触发）+ Inline Keyboard（invoke 按钮组）
```bash
curl -sS -X POST \
  -H "Content-Type: application/json" \
  -H "X-App-Secret: $APP_SECRET" \
  -d '{
    "converseId": "<会话ID>",
    "content": "📋 请选择操作，或使用下方快速按钮",
    "meta": {
      "replyKeyboard": {
        "keyboard": [[ {"text": "📊 查看统计"}, {"text": "📋 查看列表"} ], [ {"text": "🗑️ 清理消息"} ]],
        "resize": true,
        "one_time": false,
        "placeholder": "请选择操作…",
        "trigger": "button",
        "toggleLabel": "键盘",
        "toggleIcon": "mdi:keyboard-outline"
      },
      "inlineActions": {
        "actions": [
          { "id": "prev_page",    "type": "invoke",  "label": "上一页",     "params": {"action": "prev_page"},    "priority": "secondary" },
          { "id": "next_page",    "type": "invoke",  "label": "下一页",     "params": {"action": "next_page"},    "priority": "secondary" },
          { "id": "confirm_delete","type": "invoke", "label": "确认删除",   "params": {"action": "confirm_delete"},"priority": "danger"    },
          { "id": "help_url",     "type": "url",     "label": "查看文档",   "params": {"url": "https://tailchat.msgbyte.com"},       "priority": "primary" }
        ],
        "keyboard": [
          { "actions": ["prev_page", "next_page"] },
          { "actions": ["confirm_delete", "help_url"] }
        ]
      }
    }
  }' \
  "$TC_HOST/api/openapi/bot/sendMessage"
```

---

## POST /api/openapi/app/getBotCommandMeta — 获取命令元信息（新增）
- 作用：获取命令版本与 etag，用于客户端缓存协商（If-Version/If-Etag）。

```bash
curl -sS -X POST \
  -H "Content-Type: application/json" \
  -H "X-App-Secret: $APP_SECRET" \
  -d '{
    "appId": "<你的appId>"
  }' \
  "$TC_HOST/api/openapi/app/getBotCommandMeta"
```

期望返回（示例）：
```json
{ "appId": "app_xxx", "version": 12, "etag": "W/\"cmds-12\"", "updatedAt": "2025-11-01T12:34:56.789Z" }
```

---

## POST /api/openapi/app/getBotCommandsByUserIds — 按机器人用户ID获取命令（新增）
- 作用：为指定机器人用户（建议单个调用）拉取在当前会话下可见的命令，支持 If-Version/If-Etag 协商返回。

```bash
curl -sS -X POST \
  -H "Content-Type: application/json" \
  -H "X-App-Secret: $APP_SECRET" \
  -d '{
    "botUserIds": ["<机器人用户ID>"] ,
    "converseId": "<会话ID>",
    "groupId": "<群组ID或留空>",
    "ifVersion": 12,
    "ifEtag": "W/\"cmds-12\""
  }' \
  "$TC_HOST/api/openapi/app/getBotCommandsByUserIds"
```

返回（命中缓存示例）：
```json
[{ "appId": "app_xxx", "userId": "<机器人ID>", "notModified": true, "version": 12, "etag": "W/\"cmds-12\"" }]
```

返回（下发命令示例，省略部分字段）：
```json
[{ "appId": "app_xxx", "userId": "<机器人ID>", "commands": [{ "command": "help", "description": "显示帮助" }], "version": 13, "etag": "W/\"cmds-13\"" }]
```

---

## POST /api/openapi/app/setAppInfo — 设置应用信息（新增）
- 作用：仅允许修改 `appName/appDesc/appIcon`。

```bash
curl -sS -X POST \
  -H "Content-Type: application/json" \
  -H "X-App-Secret: $APP_SECRET" \
  -d '{
    "fieldName": "appName",
    "fieldValue": "My Clean Bot"
  }' \
  "$TC_HOST/api/openapi/app/setAppInfo"
```

---

## POST /api/openapi/app/setAppCapability — 设置应用能力（新增）
- 作用：覆盖启用能力列表（如 `bot`）。

```bash
curl -sS -X POST \
  -H "Content-Type: application/json" \
  -H "X-App-Secret: $APP_SECRET" \
  -d '{
    "capability": ["bot"]
  }' \
  "$TC_HOST/api/openapi/app/setAppCapability"
```

---

## POST /api/openapi/app/setAppOAuthInfo — 设置 OAuth 信息（新增）
- 作用：目前仅支持设置 `redirectUrls` 数组。

```bash
curl -sS -X POST \
  -H "Content-Type: application/json" \
  -H "X-App-Secret: $APP_SECRET" \
  -d '{
    "fieldName": "redirectUrls",
    "fieldValue": ["https://your.example.com/oauth/callback"]
  }' \
  "$TC_HOST/api/openapi/app/setAppOAuthInfo"
```

---

## POST /api/openapi/bot/answerCallbackQuery — 带 cache_time 的变体（补充）
- 说明：除 `appSecret/traceId/userId/text/show_alert` 外，可选传 `cache_time`（秒）。

```bash
curl -sS -X POST \
  -H "Content-Type: application/json" \
  -H "X-App-Secret: $APP_SECRET" \
  -d '{
    "appSecret": "'$APP_SECRET'",
    "traceId": "<回调traceId>",
    "userId": "<点击用户ID>",
    "text": "已处理",
    "show_alert": false,
    "cache_time": 5
  }' \
  "$TC_HOST/api/openapi/bot/answerCallbackQuery"
```

## B) RK（一次性 one_time）+ Inline （带 ranges 文本区间按钮）
```bash
curl -sS -X POST \
  -H "Content-Type: application/json" \
  -H "X-App-Secret: $APP_SECRET" \
  -d '{
    "converseId": "<会话ID>",
    "content": "本段文字包含一个[操作]范围，点击可触发动作。",
    "meta": {
      "replyKeyboard": {
        "keyboard": [[ {"text": "✅ 完成"}, {"text": "❌ 取消"} ]],
        "one_time": true,
        "placeholder": "请选择操作…",
        "trigger": "button"
      },
      "inlineActions": {
        "actions": [
          { "id": "do_action", "type": "invoke", "label": "操作", "params": {"action": "do_action"}, "priority": "success" }
        ],
        "ranges": [
          { "offset": 8, "length": 4, "actionId": "do_action" }
        ]
      }
    }
  }' \
  "$TC_HOST/api/openapi/bot/sendMessage"
```

> 提示：`ranges.offset/length` 基于 content 的 UTF-16 编码长度；请按实际文本计算。

## C) RK（群聊 selective 可见）+ Inline（命令按钮 command）
```bash
curl -sS -X POST \
  -H "Content-Type: application/json" \
  -H "X-App-Secret: $APP_SECRET" \
  -d '{
    "converseId": "<群聊会话ID>",
    "groupId": "<群组ID>",
    "content": "仅特定用户可见的键盘 + 命令按钮",
    "meta": {
      "replyKeyboard": {
        "keyboard": [[ {"text": "📊 查看统计"} ]],
        "placeholder": "请选择操作…",
        "trigger": "button",
        "selective": { "visibleForUserIds": ["<用户AID>", "<用户BID>"] }
      },
      "inlineActions": {
        "actions": [
          { "id": "open_help_cmd", "type": "command", "label": "帮助", "params": {"text": "/help", "mode": "replace"}, "priority": "primary" }
        ],
        "keyboard": [
          { "actions": ["open_help_cmd"] }
        ]
      }
    }
  }' \
  "$TC_HOST/api/openapi/bot/sendMessage"
```

## D) 通过 editMessage 移除 RK，保留 Inline 按钮
```bash
curl -sS -X POST \
  -H "Content-Type: application/json" \
  -H "X-App-Secret: $APP_SECRET" \
  -d '{
    "messageId": "<消息ID>",
    "meta": {
      "replyKeyboard": { "remove": true }
    }
  }' \
  "$TC_HOST/api/openapi/bot/editMessage"
```

## E) Inline（invoke 按钮，带 botId，触发回调）
```bash
curl -sS -X POST \
  -H "Content-Type: application/json" \
  -H "X-App-Secret: $APP_SECRET" \
  -d '{
    "converseId": "<会话ID>",
    "content": "点击下方按钮触发机器人回调",
    "meta": {
      "inlineActions": {
        "actions": [
          { "id": "confirm_delete", "type": "invoke", "label": "确认删除", "params": {"action": "confirm_delete", "botId": "<机器人用户ID>"}, "priority": "danger" }
        ],
        "keyboard": [
          { "actions": ["confirm_delete"] }
        ]
      }
    }
  }' \
  "$TC_HOST/api/openapi/bot/sendMessage"
```

提示：用户点击该按钮后，服务端会向你的回调地址发送 `X-TC-Payload-Type: buttonCallback` 的 HTTP 请求，payload 中包含 `traceId`，可用于后续调用 `answerCallbackQuery`（有效期 30 秒）。

## 按钮排列顺序约定

- **Inline Keyboard（消息下方按钮组）**
  - 行顺序：由 `meta.inlineActions.keyboard` 外层数组顺序决定（上→下）。
  - 行内顺序：由每个行对象的 `actions` 数组顺序决定（左→右）。
  - 渲染策略：客户端不自动换行、不重排，严格按你提供的顺序渲染。建议每行不超过 4～6 个按钮以兼顾移动端。

- **Reply Keyboard（输入框上方）**
  - 行顺序：由 `meta.replyKeyboard.keyboard` 外层数组顺序决定（上→下）。
  - 行内顺序：由每个内层数组顺序决定（左→右）。
  - 宽度规则：默认按钮宽度按内容自适应；当 `resize=true` 时，同一行按钮会均分整行宽度。

- **兼容说明**
  - 上述行列语义与 Telegram 的 `inline_keyboard` / `keyboard` 一致。如从 Telegram 形态映射而来，保持原数组顺序即可得到同样的排列效果。

### 数据结构示例

#### Inline Keyboard（行×按钮，严格按顺序渲染）

```json
{
  "converseId": "<会话ID>",
  "content": "请选择…",
  "meta": {
    "inlineActions": {
      "actions": [
        { "id": "like",    "type": "invoke", "label": "👍 Like",    "params": { "botId": "<机器人用户ID>", "action": "like" } },
        { "id": "dislike", "type": "invoke", "label": "👎 Dislike", "params": { "botId": "<机器人用户ID>", "action": "dislike" } },
        { "id": "comment", "type": "modal",  "label": "💬 Comment", "params": { "title": "发表评论", "botId": "<机器人用户ID>" } }
      ],
      "keyboard": [
        { "actions": ["like", "dislike"] },
        { "actions": ["comment"] }
      ]
    }
  }
}
```

渲染效果（两行）：

```
[ 👍 Like ] [ 👎 Dislike ]
[ 💬 Comment ]
```

要点：
- 外层 `keyboard` 数组顺序 = 从上到下的行顺序。
- 每个行对象的 `actions` 顺序 = 从左到右的按钮顺序。
- 客户端不自动换行、不重排；顺序完全由你提供的数组决定。

#### Reply Keyboard（输入框上方，默认按内容宽度；resize=true 均分）

```json
{
  "converseId": "<会话ID>",
  "content": "请选择…",
  "meta": {
    "replyKeyboard": {
      "keyboard": [
        [ { "text": "Yes" }, { "text": "No" } ],
        [ { "text": "Maybe" } ]
      ],
      "resize": true,
      "one_time": false,
      "placeholder": "请选择操作…"
    }
  }
}
```

要点：
- 外层 `keyboard` 数组顺序 = 从上到下的行顺序。
- 每个内层数组顺序 = 从左到右的按钮顺序。
- 默认按钮宽度按内容；当 `resize=true` 时，同一行按钮均分整行宽度。

#### Telegram inline_keyboard → Tailchat inlineActions（映射示例）

Telegram 形态：

```json
{
  "inline_keyboard": [
    [
      { "text": "👍 Like", "callback_data": "like" },
      { "text": "👎 Dislike", "callback_data": "dislike" }
    ],
    [
      { "text": "💬 Comment", "callback_data": "comment" }
    ]
  ]
}
```

可映射为（概念示例，顺序保持一致）：

```json
{
  "meta": {
    "inlineActions": {
      "actions": [
        { "id": "like",    "type": "invoke", "label": "👍 Like",    "params": { "botId": "<机器人用户ID>", "callback_data": "like" } },
        { "id": "dislike", "type": "invoke", "label": "👎 Dislike", "params": { "botId": "<机器人用户ID>", "callback_data": "dislike" } },
        { "id": "comment", "type": "invoke", "label": "💬 Comment", "params": { "botId": "<机器人用户ID>", "callback_data": "comment" } }
      ],
      "keyboard": [
        { "actions": ["like", "dislike"] },
        { "actions": ["comment"] }
      ]
    }
  }
}
```

### Inline Actions 字段说明（与服务端/前端实现对齐）

- `meta.inlineActions.actions: InlineActionItem[]`
  - `id: string` 按钮/动作的唯一 ID（用于行引用与回调 payload）。
  - `type: "command" | "url" | "invoke" | "modal" | "deeplink"`
  - `label?: string` 前端展示文本。
  - `params?: object` 动作参数，见下文“动作类型参数”。

- `meta.inlineActions.keyboard: { actions: string[]; label?: string }[]`
  - 每个元素是一行；`actions` 填 `actions[].id`，决定行内从左到右顺序。
  - 可选 `label` 用于该行的分组说明（前端会显示在该行上方）。

- `meta.inlineActions.ranges: { offset: number; length: number; actionId: string }[]`
  - 使消息正文中某一段文字可点击，`actionId` 对应到 `actions[].id`。
  - `offset/length` 基于消息 `content` 的 UTF-16 长度；详见上文 “ranges 提示”。

- 其它可选：`scopes?: string[]`、`signature?: string`、`analytics?: { traceId?: string }`
  - `analytics.traceId` 可自定义（可选）；若不提供，前端在点击时会自动生成并带入回调 payload。

### 动作类型参数（与客户端行为/服务端路由对齐）

- `type: "command"`
  - `params.text: string` 要填入输入框的命令文本（如：`"/help"`）。
  - `params.mode: "replace" | "send"` 默认 `replace`。
    - `replace`：将文本填入输入框，不立即发送。
    - `send`：立即发送（将作为一条消息发出）。

- `type: "url"`
  - `params.url: string` 仅支持 `http://` 或 `https://`。点击后前端先路由再 `window.open(url)`。

- `type: "invoke"`
  - 用于触发机器人回调。
  - `params.botId: string` 目标机器人用户 ID（必填，决定回调路由到哪个机器人）。
  - `params.action?: string | object` 你自定义的动作标识/负载（原样回传到回调 payload 的 `params` 中）。
  - `params.confirm?: boolean` 若为 `true`，前端点击时会先询问一次确认。
  - `params.sig?`/`signature?` 可选签名字段（若开启相关校验时使用）。

- `type: "modal"`
  - 语义等同于 `invoke`，但点击后先展示一个确认弹窗。
  - `params.botId: string`（必填）。
  - `params.title?: string` 弹窗标题；
  - `params.content?: string` 弹窗内容；
  - 通过确认后，前端会调用与 `invoke` 相同的点击路由逻辑。

- `type: "deeplink"`
  - `params.link` 或 `params.url`：允许的协议白名单为 `http: / https: / tailchat: / tc:`。

- 通用可选参数（影响前端展示/追踪，不改变顺序）
  - `params.priority?: "primary" | "danger" | "success" | "secondary"` 按钮样式优先级（仅 UI）。
  - `params.disabled?: boolean` 置灰并禁用按钮。
  - `params.traceId?: string` 自定义追踪 ID；若缺省，前端会生成并透传到回调。

### Inline ranges 示例（让正文一段文字可点击）

```bash
curl -sS -X POST \
  -H "Content-Type: application/json" \
  -H "X-App-Secret: $APP_SECRET" \
  -d '{
    "converseId": "<会话ID>",
    "content": "点击【操作】以继续",
    "meta": {
      "inlineActions": {
        "actions": [
          { "id": "do_action", "type": "invoke", "label": "操作", "params": { "botId": "<机器人用户ID>", "action": "do_action" } }
        ],
        "ranges": [
          { "offset": 2, "length": 4, "actionId": "do_action" }
        ]
      }
    }
  }' \
  "$TC_HOST/api/openapi/bot/sendMessage"
```

> 注：`offset/length` 基于 UTF-16 计算；上述例子中“【操作】”位于索引 2 起，长度 4（按实际文本计算）。

### Reply Keyboard 字段说明（与实现对齐）

`meta.replyKeyboard: ReplyKeyboardMeta`

- `keyboard: { text: string }[][]` 按二维数组定义按钮（外层：行；内层：列）。
- `resize?: boolean` 仅当为 `true` 时，同一行按钮均分整行宽度；默认按内容宽度。
- `one_time?: boolean` 用户点击后自动关闭该键盘（客户端会立即隐藏）。
- `remove?: boolean` 配合 `editMessage` 使用以移除当前键盘。
- `placeholder?: string` 输入框占位提示。
- `selective?: { visibleForUserIds?: string[] }` 仅对特定用户显示。
- `trigger?: "auto" | "button"` `button` 时默认折叠在“键盘”按钮里，点击后展开；`auto` 时自动展开。
- `toggleLabel?: string`/`toggleIcon?: string` 当 `trigger=button` 时，控制折叠按钮的文案与图标。

### Reply Keyboard 行为说明

- 排列顺序：外层数组决定行顺序（上→下），内层数组决定行内顺序（左→右）。
- 宽度规则：默认按内容；`resize=true` 时，同一行按钮 `flex:1` 均分整行。
- 不自动换行：一行放多少个按钮完全由你决定（建议 4～6 个）。
- `one_time=true`：点击发送后前端立即关闭该键盘；如需再次显示请在后续消息中重新下发。

### 最佳实践

- 移动端友好：建议每行 ≤ 4～6 个按钮，文本尽量精炼；避免超长文案。
- 链接安全：`url` 协议限制为 `http/https`；`deeplink` 仅允许白名单协议。
- 回调可用性：`invoke/modal` 需在 `params` 中携带 `botId` 才会触发 `buttonCallback`。

### 回调流程（buttonCallback 与 answerCallbackQuery）

1) 用户点击 `invoke`/`modal` 按钮（且含 `botId`）
   - 前端调用点击网关，服务端向你的回调地址发送 `X-TC-Payload-Type: buttonCallback`，包含 `traceId`。
2) 你的服务收到回调后，可在 30 秒内调用 `answerCallbackQuery`
   - 请求体需要 `appSecret`、`traceId`、`userId`、`text`、`show_alert` 等。
   - 客户端将以 toast/弹窗反馈给“点击该按钮的用户”。
3) `command/url/deeplink` 不会触发 HTTP 回调（仅前端本地处理或打开链接）。

# Tailchat OpenAPI cURL 示例（阶段 1：openapi.bot）

> 本文提供无需 SDK 的 cURL 示例，按接口分阶段补充。当前阶段覆盖 `openapi.bot` 的 whoami。
> 所有接口统一使用请求头 `X-App-Secret: appId:secret` 进行鉴权。

## 环境变量（建议先在 Shell 中设置）

```bash
export TC_HOST="http://localhost:11000"        # 服务器地址
export APP_SECRET="yourAppId:yourSecretHere"   # 开放平台 appId:secret 组合
```

---

## GET /api/openapi/bot/whoami —— 获取机器人身份
- 作用：确认 `X-App-Secret` 对应的机器人是谁（便于后续调试）
- 鉴权：请求头 `X-App-Secret: appId:secret`
- 返回：机器人用户的基础信息（_id, nickname, email, avatar）

```bash
curl -sS \
  -H "X-App-Secret: $APP_SECRET" \
  "$TC_HOST/api/openapi/bot/whoami"
```

期望返回（示例）：
```json
{
  "_id": "64f...",
  "nickname": "MyBot",
  "email": "bot@example.com",
  "avatar": "https://.../avatar.png"
}
```

---

## POST /api/openapi/bot/sendMessage —— 发送消息
- 作用：向指定会话发送文本消息，可选携带元数据（如 Reply Keyboard、内联按钮等）
- 鉴权：请求头 `X-App-Secret: appId:secret`

### 仅发送纯文本
```bash
curl -sS -X POST \
  -H "Content-Type: application/json" \
  -H "X-App-Secret: $APP_SECRET" \
  -d '{
    "converseId": "<会话ID>",
    "content": "Hello from cURL"
  }' \
  "$TC_HOST/api/openapi/bot/sendMessage"
```

---

## POST /api/openapi/app/getBotCommands —— 获取机器人命令列表
- 作用：查询当前应用已注册的所有命令（不区分 scope）
- 鉴权：请求头 `X-App-Secret: appId:secret`

```bash
curl -sS -X POST \
  -H "Content-Type: application/json" \
  -H "X-App-Secret: $APP_SECRET" \
  -d '{
    "appId": "<你的appId>"
  }' \
  "$TC_HOST/api/openapi/app/getBotCommands"
```

---

## POST /api/openapi/app/getBotCommandsByScope —— 按范围获取命令
- 作用：根据 `scopeType`（及 chatId/userId）筛选命令列表
- scopeType 取值：`default` / `all_private_chats` / `all_group_chats` / `chat` / `chat_member`
- 当 scopeType 为 `chat` 或 `chat_member` 时需要提供 `chatId`；`chat_member` 还需要 `userId`

```bash
curl -sS -X POST \
  -H "Content-Type: application/json" \
  -H "X-App-Secret: $APP_SECRET" \
  -d '{
    "appId": "<你的appId>",
    "scopeType": "default"
  }' \
  "$TC_HOST/api/openapi/app/getBotCommandsByScope"
```

示例：按某个会话 `chat` 查询
```bash
curl -sS -X POST \
  -H "Content-Type: application/json" \
  -H "X-App-Secret: $APP_SECRET" \
  -d '{
    "appId": "<你的appId>",
    "scopeType": "chat",
    "chatId": "<会话ID>"
  }' \
  "$TC_HOST/api/openapi/app/getBotCommandsByScope"
```

---

## POST /api/openapi/app/getForIntegration —— 查询应用信息（集成场景）
- 作用：通过 `appSecret` 查询应用基础信息（通常用于 SDK 初始化）
- 鉴权：请求头 `X-App-Secret: appId:secret`

```bash
curl -sS -X POST \
  -H "Content-Type: application/json" \
  -H "X-App-Secret: $APP_SECRET" \
  -d '{
    "appSecret": "'$APP_SECRET'"
  }' \
  "$TC_HOST/api/openapi/app/getForIntegration"
```

---

# Webhook 本地联调示例（模拟服务器回调）

> 说明：以下示例演示如何用 cURL 手动向你的机器人回调地址发送事件，以便本地联调（跳过服务器）。
> 请将 `http://localhost:3000/bot/callback` 替换为你的服务实际回调 URL。

## inbox —— 消息收件箱回调
- 触发场景：用户在群聊 @ 机器人，或用户向 openapi 机器人发送 DM 文本时。
- 服务器真实回调时会带 Header：`X-TC-Payload-Type: inbox`

示例负载（简化）：
```json
{
  "_id": "69103af5aaea7c53ecaf53b3",
  "userId": "<机器人ID>",
  "type": "message",
  "payload": {
    "converseId": "<会话ID>",
    "messageId": "<消息ID>",
    "messageAuthor": "<用户ID>",
    "messageSnippet": "/start",
    "messagePlainContent": "/start"
  }
}
```

本地模拟回调：
```bash
curl -sS -X POST \
  -H "Content-Type: application/json" \
  -H "X-TC-Payload-Type: inbox" \
  -d '{
    "_id": "69103af5aaea7c53ecaf53b3",
    "userId": "<机器人ID>",
    "type": "message",
    "payload": {
      "converseId": "<会话ID>",
      "messageId": "<消息ID>",
      "messageAuthor": "<用户ID>",
      "messageSnippet": "/start",
      "messagePlainContent": "/start"
    }
  }' \
  "http://localhost:3000/bot/callback"
```
### buttonCallback 字段说明与约束

- `payload.messageAuthor: string` 点击按钮的用户 ID。
- `payload.converseId: string` 发生点击的会话 ID。
- `payload.groupId: string | null` 群组 ID（若在群聊中）。
- `payload.originalMessageId: string` 原消息 ID。
- `payload.actionId: string` 触发的动作 ID（对应 `inlineActions.actions[].id`）。
- `payload.type: "invoke" | "modal"` 回调仅在这两类动作且可路由到机器人时触发。
- `payload.params: object` 你在按钮里透传的业务参数（如 `action`、`sessionId` 等）。
- `payload.traceId: string` 用于后续 `answerCallbackQuery`，有效期 30 秒，且与点击用户、机器人绑定。
- `payload.ts: number` 服务器时间戳（毫秒）。

约束与补充：
- 只有 `invoke`/`modal` 且在 `params` 中携带 `botId` 时，才能路由到你的机器人并产生回调。
- `command`/`url`/`deeplink` 不会触发 HTTP 回调。
- `answerCallbackQuery` 同一个 `traceId` 只能使用一次；超时或不匹配会报错（见下文接口说明）。

---

## dm.start —— 私信 /start 深链事件
- 触发场景：用户与机器人建立 DM 并触发 /start（或通过 deep link）。
- Header：`X-TC-Payload-Type: dm.start`

示例负载：
```json
{
  "type": "dm.start",
  "payload": {
    "botUserId": "<机器人ID>",
    "fromUserId": "<用户ID>",
    "converseId": "<DM会话ID>",
    "params": { "text": "rk_show" },
    "timestamp": 1731139200000
  }
}
```

本地模拟回调：
```bash
curl -sS -X POST \
  -H "Content-Type: application/json" \
  -H "X-TC-Payload-Type: dm.start" \
  -d '{
    "type": "dm.start",
    "payload": {
      "botUserId": "<机器人ID>",
      "fromUserId": "<用户ID>",
      "converseId": "<DM会话ID>",
      "params": { "text": "rk_show" },
      "timestamp": 1731139200000
    }
  }' \
  "http://localhost:3000/bot/callback"
```

---

## 区分 startBotDM 与普通 /start
- 判断依据：查看回调请求头 `X-TC-Payload-Type`
  - `dm.start`：表示通过 `chat.converse.startBotDM`（深链/开始使用）触发。
  - `inbox`：表示普通消息回调。若用户在 DM 里手动输入 `/start`，会以 `inbox` 形式到达，文本在 `payload.messagePlainContent` 或 `payload.messageSnippet`.

示例：
- `dm.start` 负载（上文已示例）：`type: "dm.start"`，`payload` 含 `botUserId`、`fromUserId`、`converseId`、`params`、`timestamp`。
- 普通 `/start` 消息（inbox）：`type: "message"`，`payload.messagePlainContent === "/start"`。

服务端处理示例（伪代码）：
```js
app.post('/bot/callback', (req, res) => {
  const kind = req.get('X-TC-Payload-Type'); // inbox | dm.start | buttonCallback ...
  const body = req.body || {};

  if (kind === 'dm.start') {
    const { botUserId, fromUserId, converseId, params } = body.payload || {};
    // 深链/开始使用入口的初始化流程（可利用 params 进行定制）
    return res.sendStatus(200);
  }

  if (kind === 'inbox') {
    const { messagePlainContent, messageSnippet } = (body.payload || {});
    const text = (messagePlainContent || messageSnippet || '').trim();
    if (text === '/start') {
      // 普通消息里的 /start，执行同一套欢迎/初始化逻辑
    }
    return res.sendStatus(200);
  }

  return res.sendStatus(200);
});
```

---

## buttonCallback —— 内联按钮回调
- 触发场景：仅当点击类型为 invoke 或 modal，且能够路由到某个机器人（通常需要在 params 中携带 botId）时才会触发。command/url/deeplink 不会回调到你的服务。
- Header：`X-TC-Payload-Type: buttonCallback`

示例负载：
```json
{
  "type": "buttonCallback",
  "payload": {
    "messageAuthor": "<点击用户ID>",
    "converseId": "<会话ID>",
    "groupId": null,
    "originalMessageId": "<原消息ID>",
    "actionId": "confirm_delete",
    "type": "invoke",
    "params": { "action": "confirm_delete", "sessionId": "abc123" },
    "traceId": "trace-xyz",
    "ts": 1731139300000
  }
}
```

本地模拟回调：
```bash
curl -sS -X POST \
  -H "Content-Type: application/json" \
  -H "X-TC-Payload-Type: buttonCallback" \
  -d '{
    "type": "buttonCallback",
    "payload": {
      "messageAuthor": "<点击用户ID>",
      "converseId": "<会话ID>",
      "groupId": null,
      "originalMessageId": "<原消息ID>",
      "actionId": "confirm_delete",
      "type": "invoke",
      "params": { "action": "confirm_delete", "sessionId": "abc123" },
      "traceId": "trace-xyz",
      "ts": 1731139300000
    }
  }' \
  "http://localhost:3000/bot/callback"
```
## POST /api/openapi/bot/editMessage —— 编辑消息
- 作用：更新已发送消息的文本或元数据（例如：替换/移除 Reply Keyboard）
- 鉴权：请求头 `X-App-Secret: appId:secret`

### 示例：仅更新文本
```bash
curl -sS -X POST \
  -H "Content-Type: application/json" \
  -H "X-App-Secret: $APP_SECRET" \
  -d '{
    "messageId": "<消息ID>",
    "content": "更新后的文本"
  }' \
  "$TC_HOST/api/openapi/bot/editMessage"
```

### 示例：移除 Reply Keyboard
```bash
curl -sS -X POST \
  -H "Content-Type: application/json" \
  -H "X-App-Secret: $APP_SECRET" \
  -d '{
    "messageId": "<消息ID>",
    "meta": { "replyKeyboard": { "remove": true } }
  }' \
  "$TC_HOST/api/openapi/bot/editMessage"
```

---

## POST /api/openapi/bot/deleteMessage —— 删除消息
- 作用：删除已发送的消息
- 鉴权：请求头 `X-App-Secret: appId:secret`

```bash
curl -sS -X POST \
  -H "Content-Type: application/json" \
  -H "X-App-Secret: $APP_SECRET" \
  -d '{
    "messageId": "<消息ID>"
  }' \
  "$TC_HOST/api/openapi/bot/deleteMessage"
```

返回：`true/false`

权限说明：
- 群组消息：仅群组管理员可删除。
- 私信消息（DM）：仅消息作者本人（或系统）可删除。

---

## POST /api/openapi/bot/ensureDMWithUser —— 确保与某用户存在私聊
- 作用：若没有现有私聊会话，则创建并返回可用的 DM 会话 ID
- 鉴权：请求头 `X-App-Secret: appId:secret`

```bash
curl -sS -X POST \
  -H "Content-Type: application/json" \
  -H "X-App-Secret: $APP_SECRET" \
  -d '{
    "userId": "<目标用户ID>"
  }' \
  "$TC_HOST/api/openapi/bot/ensureDMWithUser"
```

期望返回：
```json
{ "converseId": "690b..." }
```

---

## POST /api/openapi/bot/answerCallbackQuery —— 回答按钮回调
- 作用：当用户点击内联按钮后，给“该用户”返回一个提示（toast/弹窗），不改变消息内容
- 鉴权：请求头 `X-App-Secret: appId:secret`，并在 Body 里同时传入 `appSecret`
- 返回：`{ "success": true }`
- 适用范围：仅用于 invoke/modal 流程。请使用回调 payload 中的 `traceId`，有效期 30 秒；超时或不匹配将报错。
- 常见错误：`Invalid or expired traceId`、`TraceId does not belong to this bot`、`UserId mismatch`、`Text too long (max 200)`、`Rate limit exceeded`。
- 限频：默认每个机器人 60 次/分钟（可通过应用配置项 `bot.callbackAnswerRateLimit` 调整）。

```bash
curl -sS -X POST \
  -H "Content-Type: application/json" \
  -H "X-App-Secret: $APP_SECRET" \
  -d '{
    "appSecret": "'$APP_SECRET'",
    "traceId": "<回调traceId>",
    "userId": "<点击用户ID>",
    "text": "操作成功",
    "show_alert": false
  }' \
  "$TC_HOST/api/openapi/bot/answerCallbackQuery"
```

---

## POST /api/openapi/app/setAppBotInfo —— 设置机器人信息/能力
- 作用：配置回调地址、机器人用户名、是否允许加入群、注册命令等
- 鉴权：请求头 `X-App-Secret: appId:secret`

### 设置回调地址 callbackUrl
```bash
curl -sS -X POST \
  -H "Content-Type: application/json" \
  -H "X-App-Secret: $APP_SECRET" \
  -d '{
    "fieldName": "callbackUrl",
    "fieldValue": "https://your-bot.example.com/bot/callback"
  }' \
  "$TC_HOST/api/openapi/app/setAppBotInfo"
```

### 设置机器人用户名 username
```bash
curl -sS -X POST \
  -H "Content-Type: application/json" \
  -H "X-App-Secret: $APP_SECRET" \
  -d '{
    "fieldName": "username",
    "fieldValue": "my_cleanmsg_bot"
  }' \
  "$TC_HOST/api/openapi/app/setAppBotInfo"
```

### 设置是否允许加入群 allowGroup
```bash
curl -sS -X POST \
  -H "Content-Type: application/json" \
  -H "X-App-Secret: $APP_SECRET" \
  -d '{
    "fieldName": "allowGroup",
    "fieldValue": true
  }' \
  "$TC_HOST/api/openapi/app/setAppBotInfo"
```

### 注册命令 commands（默认范围）
```bash
curl -sS -X POST \
  -H "Content-Type: application/json" \
  -H "X-App-Secret: $APP_SECRET" \
  -d '{
    "fieldName": "commands",
    "fieldValue": [
      { "command": "start", "description": "开始使用清理机器人", "scope": { "type": "default" } },
      { "command": "help",  "description": "显示帮助信息",       "scope": { "type": "default" } },
      { "command": "clear", "description": "清理消息",           "scope": { "type": "default" } },
      { "command": "stats", "description": "查看消息统计",       "scope": { "type": "default" } },
      { "command": "list",  "description": "查看消息列表",       "scope": { "type": "default" } }
    ]
  }' \
  "$TC_HOST/api/openapi/app/setAppBotInfo"
```

### 携带 Reply Keyboard（按钮触发模式）
- 特性：`meta.replyKeyboard.trigger: "button"` —— 客户端默认折叠，只显示“键盘”按钮；点击后展开。
- 可选：`toggleLabel` 为按钮提示文案（可传 i18n key）；`toggleIcon` 为图标名。

```bash
curl -sS -X POST \
  -H "Content-Type: application/json" \
  -H "X-App-Secret: $APP_SECRET" \
  -d '{
    "converseId": "<会话ID>",
    "content": "请选择操作…",
    "meta": {
      "replyKeyboard": {
        "keyboard": [[ {"text": "📊 查看统计"}, {"text": "📋 查看列表"} ], [ {"text": "🗑️ 清理消息"} ]],
        "resize": true,
        "one_time": false,
        "placeholder": "请选择操作…",
        "trigger": "button",
        "toggleLabel": "键盘",
        "toggleIcon": "mdi:keyboard-outline"
      }
    }
  }' \
  "$TC_HOST/api/openapi/bot/sendMessage"
```