# Docker 部署指南

## 快速开始

### 1. 构建镜像

```bash
docker build -t tailchat-forward-bot .
```

### 2. 创建网络（如果还没有）

```bash
docker network create tailchat-internal
```

### 3. 配置环境变量

确保 `.env` 文件已正确配置：

```bash
# 如果还没有 .env 文件，运行：
npm run create-env

# 然后编辑 .env 文件填写配置
```

### 4. 启动服务

```bash
docker-compose up -d
```

## 完整命令

### 构建并启动

```bash
# 构建镜像并启动服务
docker-compose up -d --build

# 查看日志
docker-compose logs -f

# 查看实时日志
docker-compose logs -f tailchat-forward-bot
```

### 管理服务

```bash
# 停止服务
docker-compose down

# 重启服务
docker-compose restart

# 查看服务状态
docker-compose ps

# 进入容器
docker-compose exec tailchat-forward-bot sh
```

## 网络配置

本服务使用以下网络：

- **tailchat-internal**: 与 Tailchat 服务通信的内部网络（外部网络）
- **default**: 容器的默认网络，用于访问外部服务（如 Telegram API）

### 创建外部网络

如果 `tailchat-internal` 网络不存在，需要先创建：

```bash
docker network create tailchat-internal
```

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

## 端口映射

默认端口映射：

- **3000:3000** - HTTP 服务端口

修改端口（在 docker-compose.yml 中）：

```yaml
ports:
  - "8080:3000"  # 宿主机:容器
```

或通过环境变量（在 .env 中）：

```env
LISTEN_PORT=3000
```

## 环境变量

在 `.env` 文件中配置：

```env
# Tailchat Configuration
TAILCHAT_HOST=https://your-tailchat-server.com
TAILCHAT_APP_SECRET=your_tailchat_bot_secret

# Telegram Configuration
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
TELEGRAM_TARGET_USER_ID=your_telegram_user_id

# Service Configuration
LISTEN_PORT=3000
```

也可以在 `docker-compose.yml` 中直接设置：

```yaml
environment:
  - TAILCHAT_HOST=https://your-tailchat-server.com
  - TAILCHAT_APP_SECRET=your_secret
  - TELEGRAM_BOT_TOKEN=your_token
  - TELEGRAM_TARGET_USER_ID=123456789
  - LISTEN_PORT=3000
```

## 健康检查

容器包含健康检查功能：

```bash
# 查看健康状态
docker-compose ps

# 手动检查
docker exec tailchat-forward-bot wget -q -O- http://localhost:3000/health
```

健康检查端点：`http://localhost:3000/health`

## 日志管理

### 查看日志

```bash
# 查看所有日志
docker-compose logs

# 查看最近 100 行
docker-compose logs --tail=100

# 实时查看
docker-compose logs -f

# 查看特定服务
docker-compose logs -f tailchat-forward-bot
```

### 日志持久化

添加日志卷（在 docker-compose.yml 中）：

```yaml
volumes:
  - ./.env:/app/.env
  - ./logs:/app/logs
```

## 故障排查

### 问题1：容器无法启动

**检查日志**：
```bash
docker-compose logs tailchat-forward-bot
```

**常见原因**：
- `.env` 文件配置错误
- 端口被占用
- 网络配置问题

### 问题2：无法连接 Tailchat

**检查网络**：
```bash
# 查看网络
docker network ls

# 检查容器网络
docker network inspect tailchat-internal

# 测试连接
docker-compose exec tailchat-forward-bot ping tailchat-server
```

**解决方案**：
- 确认 `tailchat-internal` 网络存在
- 确认 Tailchat 服务也在该网络中
- 检查 `TAILCHAT_HOST` 配置是否正确

### 问题3：无法连接 Telegram

**检查日志**：
```bash
docker-compose logs tailchat-forward-bot | grep Telegram
```

**测试连接**：
```bash
# 进入容器测试
docker-compose exec tailchat-forward-bot sh
wget http://localhost:3000/test-telegram
```

**解决方案**：
- 确认容器可以访问外网
- 检查 `TELEGRAM_BOT_TOKEN` 是否正确
- 确认已向 Bot 发送 `/start`

### 问题4：权限问题

如果遇到文件权限问题：

```bash
# 修改 .env 文件权限
chmod 600 .env

# 重新构建
docker-compose down
docker-compose up -d --build
```

## 更新部署

### 更新代码

```bash
# 拉取最新代码
git pull

# 重新构建并启动
docker-compose up -d --build
```

### 更新配置

```bash
# 编辑 .env 文件
vim .env

# 重启服务（不重新构建）
docker-compose restart
```

## 多实例部署

如果需要运行多个实例（转发到不同的 Telegram 用户）：

```yaml
services:
  forward-bot-1:
    image: tailchat-forward-bot
    container_name: tailchat-forward-bot-1
    ports:
      - "3001:3000"
    env_file:
      - .env.user1
    networks:
      - tailchat-internal
      - default

  forward-bot-2:
    image: tailchat-forward-bot
    container_name: tailchat-forward-bot-2
    ports:
      - "3002:3000"
    env_file:
      - .env.user2
    networks:
      - tailchat-internal
      - default
```

## 性能优化

### 资源限制

添加资源限制（在 docker-compose.yml 中）：

```yaml
services:
  tailchat-forward-bot:
    # ...
    deploy:
      resources:
        limits:
          cpus: '0.5'
          memory: 512M
        reservations:
          cpus: '0.25'
          memory: 256M
```

### 优化镜像大小

使用多阶段构建（已在 Dockerfile 中使用 alpine 镜像）：

```bash
# 查看镜像大小
docker images tailchat-forward-bot
```

## 备份和恢复

### 备份配置

```bash
# 备份 .env 文件
cp .env .env.backup

# 备份整个项目
tar -czf tailchat-forward-bot-backup.tar.gz .env docker-compose.yml
```

### 恢复

```bash
# 恢复配置
cp .env.backup .env

# 重启服务
docker-compose restart
```

## 安全建议

1. **保护敏感信息**：
   - 不要将 `.env` 文件提交到 Git
   - 使用 Docker secrets（生产环境）

2. **使用 HTTPS**：
   - 在生产环境使用反向代理（Nginx）
   - 配置 SSL 证书

3. **限制网络访问**：
   - 只暴露必要的端口
   - 使用防火墙规则

4. **定期更新**：
   - 更新 Node.js 基础镜像
   - 更新依赖包

## 监控

### 基础监控

```bash
# 查看容器状态
docker stats tailchat-forward-bot

# 查看资源使用
docker-compose top
```

### 集成监控系统

可以集成 Prometheus + Grafana 进行监控：

```yaml
# docker-compose.yml
services:
  tailchat-forward-bot:
    # ...
    labels:
      - "prometheus.scrape=true"
      - "prometheus.port=3000"
      - "prometheus.path=/metrics"
```

## 生产环境建议

1. **使用编排工具**：考虑使用 Kubernetes 或 Docker Swarm
2. **实现自动重启**：已配置 `restart: always`
3. **配置日志轮转**：使用 Docker 日志驱动
4. **设置监控告警**：集成监控系统
5. **定期备份**：自动化备份配置和数据

## 常用命令速查

```bash
# 构建并启动
docker-compose up -d --build

# 查看日志
docker-compose logs -f

# 重启服务
docker-compose restart

# 停止服务
docker-compose down

# 查看状态
docker-compose ps

# 进入容器
docker-compose exec tailchat-forward-bot sh

# 测试连接
curl http://localhost:3000/health
curl http://localhost:3000/test-telegram

# 清理
docker-compose down -v
docker image prune -f
```

## 获取帮助

如有问题：
1. 查看日志：`docker-compose logs -f`
2. 检查健康状态：`docker-compose ps`
3. 查看网络：`docker network inspect tailchat-internal`
4. 参考主文档：`README.md`

