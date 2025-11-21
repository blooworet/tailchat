FROM node:18-alpine

# 设置工作目录
WORKDIR /app

# 复制 package.json 和 package-lock.json
COPY package*.json ./

# 复制 tailchat-client-sdk
COPY tailchat-client-sdk ./tailchat-client-sdk

# 先安装所有依赖（包括 dev dependencies）以编译 TypeScript
RUN npm install

# 编译 SDK
RUN cd tailchat-client-sdk && npm run prepare || true

# 删除 dev dependencies，只保留生产依赖
RUN npm prune --production

# 复制应用代码
COPY index.js ./

# 暴露端口（默认 3000，可通过环境变量修改）
EXPOSE 3000

# 健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

# 启动应用
CMD ["npm", "start"]

