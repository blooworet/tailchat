FROM node:18.18.0-alpine

# use with --build-arg VERSION=xxxx
ARG VERSION

# Working directory
WORKDIR /app/tailchat

RUN ulimit -n 10240

# Install dependencies
RUN npm install -g pnpm@8.15.8
RUN npm install -g tailchat-cli@latest

COPY ./mc /usr/local/bin/mc
RUN chmod +x /usr/local/bin/mc

# Install plugins and sdk dependency
COPY ./tsconfig.json ./tsconfig.json
COPY ./packages ./packages
COPY ./server/packages ./server/packages
COPY ./server/plugins ./server/plugins
COPY ./server/package.json ./server/package.json
COPY ./server/admin/package.json ./server/admin/package.json
COPY ./server/tsconfig.json ./server/tsconfig.json
COPY ./package.json ./pnpm-workspace.yaml ./.npmrc ./
COPY ./patches ./patches
COPY ./pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Copy client
COPY ./client ./client
RUN pnpm install --frozen-lockfile

# Copy all source
COPY . .
RUN pnpm install --frozen-lockfile

# Build and cleanup (client and server)
ENV NODE_ENV=production
ENV VERSION=$VERSION
RUN pnpm build

# 删除源代码和构建依赖，只保留运行时必需的文件
RUN rm -rf ./client/web/src \
    && rm -rf ./client/shared \
    && rm -rf ./client/packages \
    && rm -rf ./client/build \
    && rm -rf ./client/desktop* \
    && rm -rf ./client/mobile \
    && rm -rf ./client/test \
    && rm -rf ./server/src \
    && rm -rf ./server/services \
    && rm -rf ./server/models \
    && rm -rf ./server/mixins \
    && rm -rf ./server/lib \
    && rm -rf ./server/test \
    && rm -rf ./server/scripts \
    && rm -rf ./server/types \
    && rm -rf ./server/admin/src \
    && rm -rf ./server/packages/*/src \
    && rm -rf ./server/plugins/*/src \
    && rm -rf ./packages/*/src \
    && rm -rf ./tsconfig*.json \
    && rm -rf ./patches \
    && rm -rf ./.git* \
    && rm -rf ./website \
    && rm -rf ./apps \
    && rm -rf ./script-bot \
    && rm -rf ./docker \
    && rm -rf ./page \
    && rm -rf ./*.md \
    && rm -rf ./*.yml \
    && rm -rf ./*.yaml \
    && rm -rf ./*.config.js \
    && rm -rf ./.prettier* \
    && rm -rf ./.eslint* \
    && rm -rf ./CHANGELOG.md \
    && rm -rf ./LICENSE \
    && pnpm store prune

# web static service port
EXPOSE 3000

# Start server, ENV var is necessary
CMD ["pnpm", "start:service"]
