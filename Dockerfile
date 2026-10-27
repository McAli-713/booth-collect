# booth-collect 容器镜像
# 纯 JS 依赖（express/pg/exceljs/resend/dotenv/cors），无需编译工具，故用 alpine 保持轻量
FROM node:20-alpine

ENV TZ=Asia/Shanghai
ENV NODE_ENV=production

WORKDIR /app

# 依赖单独一层，改代码时不必重装
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --chown=node:node server.js db.js ./
COPY --chown=node:node public ./public

# COPY 默认以 root 创建文件，切到 USER node 后，若源文件权限较严
# （如 umask 077 解压出的 600），node 用户无权读取 server.js，
# 容器启动即 EACCES 退出并无限重启 —— 故此处必须 --chown。
#
# 注意：不要改用 `RUN chown -R node:node /app`。那样会遍历 node_modules
# 数千个小文件并触发 overlay copy-up（每个文件复制到可写层），
# 实测慢至 10 分钟，且镜像体积翻倍。只 chown COPY 进来的文件即可；
# node_modules 由 npm 创建，权限本就对所有用户可读。

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD node -e "const p=process.env.PORT||3000;require('http').get('http://127.0.0.1:'+p+'/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

USER node
CMD ["node", "--dns-result-order=ipv4first", "server.js"]
