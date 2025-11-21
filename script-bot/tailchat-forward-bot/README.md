# Tailchat → Telegram 消息转发机器人

将 Tailchat 消息自动转发到 Telegram 的机器人服务。

## ✨ 功能特性

- 🤖 自动转发 Tailchat 消息到 Telegram
- 👥 支持转发到多个 Telegram 用户
- 📡 支持 HTTP Webhook 和 WebSocket 双模式
- 📝 保留完整消息信息（发送者、会话ID、群组ID等）
- 🔄 自动重连机制
- 🐳 支持 Docker 部署
- 💡 HTML 格式化消息

## 🚀 快速开始

### 方式一：直接运行（推荐用于开发）

```bash
# 1. 安装依赖
npm install

# 2. 创建配置文件
npm run create-env

# 3. 编辑 .env 文件填写配置

# 4. 启动服务
npm start
```

### 方式二：Docker 部署（推荐用于生产）

#### Windows:
```bash
build.bat
```

#### Linux/Mac:
```bash
chmod +x build.sh
./build.sh
```

或手动执行：

```bash
# 1. 创建配置文件
npm run create-env

# 2. 编辑 .env 文件

# 3. 创建网络（如果不存在）
docker network create tailchat-internal

# 4. 构建并启动
docker-compose up -d --build
```

## 📋 配置说明

### 环境变量（.env 文件）

```env
# Tailchat 配置
TAILCHAT_HOST=https://your-tailchat-server.com
TAILCHAT_APP_SECRET=your_tailchat_bot_secret

# Telegram 配置
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
TELEGRAM_TARGET_USER_ID=your_telegram_user_id

# 服务配置
LISTEN_PORT=3000
```

### 获取配置信息

#### 1. Tailchat Bot Secret

1. 登录 Tailchat 管理后台
2. 进入"开放平台" → "机器人管理"
3. 创建或选择机器人
4. 复制 `appSecret`

#### 2. Telegram Bot Token

1. 在 Telegram 搜索 [@BotFather](https://t.me/BotFather)
2. 发送 `/newbot` 创建机器人
3. 按提示操作，获取 Token

#### 3. Telegram User ID

1. 在 Telegram 搜索 [@userinfobot](https://t.me/userinfobot)
2. 发送任意消息
3. 复制返回的 ID

**⚠️ 重要**：必须先在 Telegram 向你的 Bot 发送 `/start` 命令！

## 🔧 使用方法

### 1. 设置 Tailchat Webhook

在 Tailchat 开放平台设置 Webhook 地址：

```
http://your-server:3000/bot/callback
```

### 2. 测试连接

```bash
# 测试健康状态
curl http://localhost:3000/health

# 测试 Telegram 连接
curl http://localhost:3000/test-telegram
```

### 3. 发送测试消息

在 Tailchat 中向机器人发送消息，应该会自动转发到 Telegram。

## 📊 API 端点

- `POST /bot/callback` - Tailchat Webhook 回调
- `GET /health` - 健康检查
- `GET /test-telegram` - 测试 Telegram 连接

## 🐳 Docker 部署详情

### 网络架构

```
┌─────────────────────────────────────────────────┐
│  tailchat-internal Network                      │
│                                                  │
│  ┌──────────────┐      ┌──────────────┐        │
│  │  Tailchat    │◄────►│  Forward Bot │        │
│  │  Server      │      │              │        │
│  └──────────────┘      └──────┬───────┘        │
│                               │                 │
└───────────────────────────────┼─────────────────┘
                                │
                                │ (default network)
                                │
                                ▼
                    ┌──────────────────────┐
                    │  Telegram API        │
                    │  (Internet)          │
                    └──────────────────────┘
```

### Docker 常用命令

```bash
# 启动服务
docker-compose up -d

# 查看日志
docker-compose logs -f

# 停止服务
docker-compose down

# 重启服务
docker-compose restart

# 查看状态
docker-compose ps

# 进入容器
docker-compose exec tailchat-forward-bot sh
```

详细 Docker 文档请查看：[DOCKER_GUIDE.md](DOCKER_GUIDE.md)

## 📁 项目结构

```
tailchat-forward-bot/
├── index.js              # 主程序
├── create-env.js         # 环境变量创建工具
├── package.json          # 项目依赖
├── .env.example          # 配置模板
├── Dockerfile            # Docker 镜像配置
├── docker-compose.yml    # Docker Compose 配置
├── .dockerignore         # Docker 忽略文件
├── build.sh              # Linux/Mac 构建脚本
├── build.bat             # Windows 构建脚本
├── README.md             # 本文件
└── DOCKER_GUIDE.md       # Docker 详细文档
```

## 🔍 故障排查

### 问题1：收不到消息

**检查清单**：
- ✅ .env 配置是否正确
- ✅ Tailchat Webhook 是否设置
- ✅ 已向 Telegram Bot 发送 /start
- ✅ 服务是否正常运行

### 问题2：Telegram 发送失败

**错误**：`Forbidden: bot can't initiate conversation with a user`

**解决**：在 Telegram 中找到你的 Bot，发送 `/start` 命令

### 问题3：Docker 网络问题

```bash
# 检查网络
docker network ls

# 重建网络
docker network rm tailchat-internal
docker network create tailchat-internal

# 重启服务
docker-compose restart
```

### 问题4：端口被占用

修改 docker-compose.yml：

```yaml
ports:
  - "8080:3000"  # 改为其他端口
```

或修改 .env：

```env
LISTEN_PORT=8080
```

## 📚 文档

- [快速开始](README.md) - 本文档
- [Docker 部署指南](DOCKER_GUIDE.md) - 详细的 Docker 部署文档

## 🔐 安全建议

1. **保护敏感信息**
   - 不要将 `.env` 文件提交到 Git
   - 定期更换密钥

2. **使用 HTTPS**
   - 生产环境使用反向代理（Nginx）
   - 配置 SSL 证书

3. **网络安全**
   - 只暴露必要的端口
   - 使用防火墙规则

## 🔄 更新

### 更新代码

```bash
# 拉取最新代码
git pull

# 直接运行模式
npm install
npm start

# Docker 模式
docker-compose up -d --build
```

### 更新配置

编辑 `.env` 文件后：

```bash
# 直接运行模式
npm start  # 重启即可

# Docker 模式
docker-compose restart
```

## 💡 高级功能

### 转发到多个用户

在 `.env` 中配置多个用户 ID（逗号分隔）：

```env
TELEGRAM_TARGET_USER_ID=123456789,987654321,555666777
```

### 自定义消息格式

编辑 `index.js` 中的 `formatMessageForTelegram` 函数。

### 添加消息过滤

在 `forwardToTelegram` 函数前添加条件判断：

```javascript
// 只转发特定用户
if (message.messageAuthor === 'specific_user') {
  await forwardToTelegram(message);
}

// 只转发包含关键词的消息
if (message.messageSnippet.includes('重要')) {
  await forwardToTelegram(message);
}
```

## 📊 监控

### 查看日志

```bash
# 直接运行模式
# 日志在终端输出

# Docker 模式
docker-compose logs -f tailchat-forward-bot
```

### 健康检查

```bash
curl http://localhost:3000/health
```

返回示例：

```json
{
  "status": "ok",
  "service": "tailchat-telegram-forwarder",
  "timestamp": "2024-01-01T00:00:00.000Z"
}
```

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📄 许可证

MIT License

## 🔗 相关链接

- [Tailchat 官网](https://tailchat.msgbyte.com/)
- [Tailchat 文档](https://tailchat.msgbyte.com/docs)
- [Telegram Bot API](https://core.telegram.org/bots/api)
- [Docker 文档](https://docs.docker.com/)

## ❓ 获取帮助

如有问题：

1. 查看文档：[README.md](README.md) 和 [DOCKER_GUIDE.md](DOCKER_GUIDE.md)
2. 检查日志：`docker-compose logs -f` 或终端输出
3. 测试连接：访问健康检查和测试端点
4. 提交 Issue

---

**祝使用愉快！** 🎉

