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

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD node -e "const p=process.env.PORT||3000;require('http').get('http://127.0.0.1:'+p+'/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

USER node
CMD ["node", "--dns-result-order=ipv4first", "server.js"]
