FROM node:20-alpine

WORKDIR /app

# 复制package.json以及本地SDK目录
COPY package.json .
COPY tailchat-client-sdk ./tailchat-client-sdk

RUN npm config set registry https://registry.npmmirror.com
RUN npm config set strict-ssl false
RUN npm install cnpm -g --registry=https://registry.npm.taobao.org
RUN npm config set strict-ssl true

# 先编译SDK
WORKDIR /app/tailchat-client-sdk
RUN npm install --legacy-peer-deps
RUN npm run prepare

# 返回项目根目录安装依赖，这会自动链接本地SDK
WORKDIR /app
RUN npm install

# 复制其他源代码文件
COPY server.js .
COPY clear.js .
COPY adminClient.js .

CMD ["node", "server.js"] 