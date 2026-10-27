# booth-collect 容器镜像
# 纯 JS 依赖（express/pg/exceljs/resend/dotenv/cors），无需编译工具，故用 alpine 保持轻量
FROM node:20-alpine

ENV TZ=Asia/Shanghai
ENV NODE_ENV=production

WORKDIR /app

# 依赖单独一层，改代码时不必重装
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server.js db.js ./
COPY public ./public

# COPY 以 root 身份创建文件，切换到非 root 用户前必须移交所有权。
# 否则当源文件权限较严（如 umask 077 解压出的 600）时，node 用户无权读取
# server.js，容器启动即 EACCES 退出并无限重启。
RUN chown -R node:node /app

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD node -e "const p=process.env.PORT||3000;require('http').get('http://127.0.0.1:'+p+'/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

USER node
CMD ["node", "--dns-result-order=ipv4first", "server.js"]
