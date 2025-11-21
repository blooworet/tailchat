# tailchat-server

## Build development environment

Checkout more detail in [https://tailchat.msgbyte.com/docs/deployment/dev](https://tailchat.msgbyte.com/docs/deployment/dev)

#### 服务端插件安装方式

安装所有插件
```
pnpm plugin:install all
```

安装单个插件
```
pnpm plugin:install com.msgbyte.tasks
```

## 单节点部署

#### docker-compose 一键部署

请确保已经安装了:
- docker
- docker-compose(或者docker compose plugin)


在项目根目录下执行
```bash
docker compose build # 需要编译
docker compose up -d
```

## DevOps

### Database management

Checkout more detail in [https://tailchat.msgbyte.com/docs/devops/mongodb](https://tailchat.msgbyte.com/docs/devops/mongodb)

### 通过docker volume

#### 备份
```bash
docker run -it --rm --volumes-from <DOCKER_CONTAINER_NAME> -v ${PWD}:/opt/backup --name export busybox sh

# 进入容器
tar -zcvf /opt/backup/data.tar <DATA_PATH>

exit
```
此处<DATA_PATH>, 如果是minio则为`/data/`如果是mongo则为`/data/db`

#### 恢复
```bash
docker run -it --rm --volumes-from <DOCKER_CONTAINER_NAME> -v ${PWD}:/opt/backup --name importer busybox sh
tar -zxvf /opt/backup/data.tar
exit
```


## Benchmark

### Case 1
<!--
部署环境
```
hash: 4771a830b0787280d53935948c99c340c81de977
env: development
cpu: i7-8700K
memory: 32G
节点数: 1
测试终端: tailchat-cli
测试脚本: bench --time 60 --num 10000 "chat.message.sendMessage" '{"converseId": "61fa58845aff4f8a3e68ccf3", "groupId": "61fa58845aff4f8a3e68ccf4", "content": "123"}'

备注:
- 使用`Redis`作为消息中转中心, `Redis`部署在局域网的nas上
- 使用一个真实账户作为消息推送的接收方
```

```
Benchmark result:

  3,845 requests in 1m, 0 error

  Requests/sec: 64

  Latency:
    Avg:       15ms
    Min:        9ms
    Max:       91ms
```
-->
### Case 2

<!-- TODO -->

## Inline Actions 配置说明（M4-M6）

服务端可用配置（`moleculer.config.ts` 或环境变量映射）：

- `feature.inlineActionRequireSignature`: 是否强制校验内联动作签名（HMAC-SHA256）。开启后前端需携带 `params.sig`。
- `feature.inlineUrlWhitelistRequired`: 是否强制要求 URL 域名白名单。开启且未配置任何白名单时，URL 动作将被拒绝。
- `inlineUrlWhitelist`: URL 域名白名单（数组）。例如：`["example.com", "foo.bar"]` 将允许 `*.example.com` 与 `*.foo.bar`。
- `inlineDeeplinkWhitelist`: Deeplink 允许的协议白名单（默认 `['http:', 'https:', 'tailchat:', 'tc:']`）。
- `inlineActionRateLimit`: 速率限制配置对象：
  - `clickLimit`/`clickWindowSec`: 点击上报的次数与窗口秒数（默认 20/10）。
  - `trackLimit`/`trackWindowSec`: 埋点上报的次数与窗口秒数（默认 60/10）。
- `inlineActionSampling.sampleRate`: 埋点采样率 (0,1]，默认 1（全量）。

必备运维项：

- `config.secret`：用于 HMAC-SHA256 的服务端密钥，必须配置且建议定期轮换；缺失时将拒绝内联动作请求。
- `broker.cacher`：建议在生产启用（如 Redis）。若未外部提供，系统会回退到内存缓存以支持 nonce 与限流，但不建议长期使用内存缓存于多实例场景。
- `inlineActionTrackLimit.maxExtraBytes`: 埋点附加字段 `extra` 的最大字节数（默认 2048）。

相关服务端接口（`inline.action`）：

- `click`: 处理非 command 的动作点击。请求体包含 `actionId`、`type`、可选 `botId/params/signature/analytics`；响应返回 `{ ok, routed, route?, analytics }`。
- `track`: 埋点上报，事件白名单包括 `inline.text.render`、`inline.keyboard.render`、`inline.command.click`、`inline.action.click`、`inline.url.opened`、`inline.deeplink.opened`、`inline.modal.confirm`、`inline.invoke.sent`。
- `schema`: 返回埋点事件白名单与字段列表。
- `export`: 导出最近埋点（内存缓冲），支持 `since`（时间戳）与 `limit`（最多 1000）。

错误码与回退：

- 常见错误码：`INVALID_SIGNATURE`、`URL_SCHEME_NOT_ALLOWED`、`URL_NOT_ALLOWED`、`INVALID_URL`、`DEEPLINK_NOT_ALLOWED`、`INVALID_DEEPLINK`、`RATE_LIMIT`、`SCOPE_DENIED`、`COMMAND_NOT_ALLOWED`。
- 前端默认将上述错误码映射为用户友好提示，并在失败时保留命令类动作不受影响的回退策略。

示例生产配置（环境变量映射）：

```
# HMAC Secret（必须配置，建议定期轮换）
SECRET=change_me_to_strong_random

# URL 白名单（多个域名以逗号分隔）
INLINE_URL_WHITELIST=example.com,foo.bar

# Deeplink 协议白名单（逗号分隔，小写，含冒号）
INLINE_DEEPLINK_WHITELIST=http:,https:,tailchat:,tc:

# 强制白名单
FEATURE_INLINE_URL_WHITELIST_REQUIRED=true
FEATURE_INLINE_DEEPLINK_WHITELIST_REQUIRED=true

# 强制签名
FEATURE_INLINE_ACTION_REQUIRE_SIGNATURE=true

# 限流（点击/埋点）
INLINE_ACTION_RATE_LIMIT_CLICK_LIMIT=20
INLINE_ACTION_RATE_LIMIT_CLICK_WINDOW_SEC=10
INLINE_ACTION_RATE_LIMIT_TRACK_LIMIT=60
INLINE_ACTION_RATE_LIMIT_TRACK_WINDOW_SEC=10

# 采样率（1 表示全量）
INLINE_ACTION_SAMPLING_SAMPLE_RATE=1
```

上线/回滚 Runbook（摘要）：

1) 预检
- 确认 SECRET 已配置且足够强；Redis/Moleculer cacher 已启用
- 梳理 URL 白名单清单并配置；确认 Deeplink 协议策略
- 给需要的机器人 Token 赋予 `inline.invoke`/`inline.url`/`inline.modal`/`inline.deeplink` scopes

2) 灰度
- 打开 `FEATURE_INLINE_ACTION_REQUIRE_SIGNATURE=true`
- 开启 `FEATURE_INLINE_URL_WHITELIST_REQUIRED` 与 `FEATURE_INLINE_DEEPLINK_WHITELIST_REQUIRED`
- 逐步放量非 command 动作（前端 A/B 不关闭 `inline_click_disable`）

3) 验证
- 观察 `inline.action.click`/`inline.action.error`/`inline.click.routed` 指标与审计日志
- 检查 URL/Deeplink 被拒绝命中是否符合预期

4) 回滚
- 关闭非 command 动作：前端设置 `window.__TC_AB.inline_click_disable=true` 或下发 AB 配置
- 保留命令类（M1/M2）不受影响
