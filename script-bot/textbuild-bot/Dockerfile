# ================================================
# Dockerfile for TextBuild Bot
# 文字制作机器人 Docker 镜像
# ================================================

# 使用 Node.js 20 Alpine 作为基础镜像（更轻量）
FROM node:20-alpine

# 设置工作目录
WORKDIR /app

# ================================================
# 安装 Canvas 系统依赖和中文字体
# ================================================
# Canvas 需要 cairo, pango 等系统库
# 安装字体以支持中英文字符渲染
RUN apk add --no-cache \
    build-base \
    g++ \
    cairo-dev \
    jpeg-dev \
    pango-dev \
    giflib-dev \
    pixman-dev \
    pangomm-dev \
    libjpeg-turbo-dev \
    freetype-dev \
    fontconfig \
    font-noto-cjk \
    font-noto-emoji \
    ttf-dejavu

# 更新字体缓存
RUN fc-cache -f -v

# ================================================
# 配置 npm 镜像源（可选，加速国内构建）
# ================================================
# RUN npm config set registry https://registry.npmmirror.com

# ================================================
# 构建本地 SDK
# ================================================
# 复制 SDK 目录
COPY tailchat-client-sdk ./tailchat-client-sdk

# 进入 SDK 目录，安装依赖并构建
WORKDIR /app/tailchat-client-sdk
RUN npm install --legacy-peer-deps && \
    npm run prepare

# ================================================
# 安装项目依赖
# ================================================
# 返回项目根目录
WORKDIR /app

# 复制 package.json 和 package-lock.json
COPY package*.json ./

# 安装项目依赖（会自动链接本地 SDK）
RUN npm install --production

# ================================================
# 复制项目源码
# ================================================
COPY config.js ./
COPY index.js ./
COPY commands.js ./
COPY handlers ./handlers
COPY utils ./utils

# ================================================
# 创建非 root 用户运行应用（安全最佳实践）
# ================================================
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# 更改文件所有权
RUN chown -R nodejs:nodejs /app

# 切换到非 root 用户
USER nodejs

# ================================================
# 健康检查（可选）
# ================================================
# HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
#   CMD node -e "require('http').get('http://localhost:3000/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# ================================================
# 暴露端口（如果需要 HTTP 服务）
# ================================================
# EXPOSE 3000

# ================================================
# 设置环境变量
# ================================================
ENV NODE_ENV=production

# ================================================
# 启动命令
# ================================================
CMD ["node", "index.js"]

