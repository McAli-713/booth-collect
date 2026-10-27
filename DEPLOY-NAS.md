# booth-collect 部署到 NAS（飞牛 FNOS / 通用 Docker 主机）

把原本跑在 Render + Neon 的「喷房现场勘测系统」搬到自己的 NAS 上，本机只依赖 Docker，不再依赖任何云服务。

部署形态：`booth-app`（Node 应用）+ `booth-db`（PostgreSQL）两个容器，照片以 base64 存在数据库里，通过卷持久化。

---

## 一、你需要准备什么

| 项目 | 说明 |
|---|---|
| NAS | 飞牛 FNOS（基于 Debian，内置 Docker） |
| Docker | FNOS「应用中心」里安装/启用 Docker 即可 |
| SSH | FNOS「设置 → 系统（或终端）→ SSH」开启，用于命令行操作 |
| 内存 | ≥ 2GB 可用（Postgres + Node 各占一两百 MB，够用） |
| 代码 | 仓库里已包含 `Dockerfile`、`docker-compose.yml`、`.env.example` |

> 本项目已同步做了一处适配改动：`db.js` 原先硬编码 `ssl:{rejectUnauthorized:true}`（云端 Neon 需要），
> 但 NAS 内网自建 Postgres 默认不启用 SSL，强制 SSL 会直接连不上。现改为**自动判断**：
> 连接串含 `neon.tech` / `supabase.com` / `sslmode=require` 才走 SSL，内网地址则不用 SSL。
> 也可用 `DB_SSL=true|false` 显式覆盖。云端 Render 的原有行为完全不变。

---

## 二、开放署（推荐，SSH 命令行）

### 1. 登录 NAS 并建目录

```bash
ssh 你的用户名@你的NAS内网IP      # Windows 可用 cmd / PowerShell / Termius
sudo -i                            # 切 root
mkdir -p /vol1/1000/docker/booth-collect
cd /vol1/1000/docker/booth-collect
```

> `/vol1/1000` 是 FNOS 常见存储池路径，**以你自己的实际路径为准**（可在 FNOS 文件管理器里确认）。

### 2. 上传这四个文件到该目录

从项目仓库取：

- `Dockerfile`
- `docker-compose.yml`
- `.env.example`
- 以及应用的 `server.js`、`db.js`、`package.json`、`package-lock.json`、`public/`（含 `index.html`、`admin.html`、`vendor/`）

目录结构应形如：

```
/vol1/1000/docker/booth-collect/
├── Dockerfile
├── docker-compose.yml
├── .env
├── .env.example
├── package.json
├── package-lock.json
├── server.js
├── db.js
└── public/
    ├── index.html
    ├── admin.html
    ├── images/
    └── vendor/
```

最简单的方式：整个项目目录打包上传后解压，或 `git clone` 你的 GitHub 仓库到该目录。

### 3. 配置环境变量

```bash
cp .env.example .env
vi .env          # 或用 FNOS 文件管理器在线编辑
```

必须修改两项：

```env
POSTGRES_PASSWORD=换成强密码
ADMIN_PASSWORD=至少8位的后台密码
```

其他保持默认即可。`HOST_PORT=3000` 若与 NAS 上已有服务冲突，改成 `8080`、`5100` 等。

> `ADMIN_PASSWORD` 少于 8 位时，`server.js` 会拒绝启动并在日志里报错——这是刻意的保护。

### 4. 构建并启动

```bash
docker compose up -d --build
```

首次会拉镜像 + `npm ci`，约 1–3 分钟。

### 5. 验证

```bash
docker compose ps          # 两个容器都应为 Up (healthy)
docker compose logs -f app # 应看到「喷房勘测系统运行在端口 3000」
curl http://127.0.0.1:3000/api/health    # 应返回 {"status":"ok",...}
```

浏览器打开：

- 客户填写页：`http://NAS内网IP:3000/?code=你的邀请码`
- 管理后台：`http://NAS内网IP:3000/admin`

用 `.env` 里的 `ADMIN_USERNAME` / `ADMIN_PASSWORD` 登录。

---

## 三、不习惯 SSH？用 FNOS 图形界面

1. 打开 FNOS「Docker」应用 → 找到「Compose / 容器编排」
2. 新建项目，项目名填 `booth-collect`
3. 把 `docker-compose.yml` 的内容粘贴进去
4. 在项目的环境变量/高级设置处填 `POSTGRES_PASSWORD`、`ADMIN_PASSWORD` 等
5. 点击运行/部署

> 界面版通常**只支持贴 Compose 文本**，不含 Dockerfile 构建，因此建议改用 SSH 方式，
> 或者在 compose 里把 `build: .` 换成已推送到镜像仓库的 `image:`。命令行方式最省事。

---

## 四、日常运维

```bash
cd /vol1/1000/docker/booth-collect

docker compose stop          # 停止
docker compose start         # 启动
docker compose restart       # 重启
docker compose logs -f app   # 看应用日志
docker compose down          # 删除容器（数据卷保留，记录不丢）

# 更新代码后重新部署
git pull                     # 若用 git clone 方式
docker compose up -d --build
```

---

## 五、备份（重要）

照片以 base64 存在 Postgres 里，**数据库就是全部数据**。推荐直接备份数据卷：

```bash
# 备份（在 compose 所在目录）
docker compose stop app
tar czf /vol1/1000/backup/booth-db-$(date +%Y%m%d).tar.gz data/postgres
docker compose start app
```

或用逻辑导出（更通用、体积小）：

```bash
docker exec -t booth-db pg_dump -U booth -d booth -Fc > booth-$(date +%Y%m%d).dump

# 恢复
docker exec -i booth-db pg_restore -U booth -d booth -c < booth-20261027.dump
```

建议加个定时任务每周备份一次，并把备份文件同步到 NAS 之外的地方。

---

## 六、把 Render 上的老数据迁过来

如果 NAS 是**新环境**且想把云端已有记录搬过来：

```bash
# 1) 在原 Render 项目的 Neon 数据库上导出（需要有 Neon 连接串）
pg_dump "postgresql://user:pass@ep-xxx.neon.tech/neondb?sslmode=require" -Fc > booth.dump

# 2) 拷到 NAS 后导入到容器
docker cp booth.dump booth-db:/tmp/booth.dump
docker exec -i booth-db pg_restore -U booth -d booth -c --no-owner < booth.dump
```

> 若 NAS 上是全新库，先确认表结构已由应用自动建好（启动一次 `docker compose up -d` 即可）。
> 迁移完成后记得把 Render 项目停用，避免两边同时写入。

---

## 七、外网访问（按需）

默认只在局域网可用。若要让客户在外网填写，常见几种方式：

| 方案 | 复杂度 | 说明 |
|---|---|---|
| FNOS 自带远程访问 | 低 | 若官方提供了内网穿透，直接用 |
| Tailscale / WireGuard | 中 | 装个容器即可，最安全，推荐自己人用 |
| 路由器端口转发 + DDNS | 中 | 需公网 IP，建议配 HTTPS |
| frp / Caddy 反代 | 较高 | 有服务器时灵活可控 |

> 开放到公网后务必改强 `ADMIN_PASSWORD`，并考虑给后台路径加访问控制。

---

## 八、出问题怎么查

| 现象 | 原因 / 处理 |
|---|---|
| 容器起来就退出 | `docker compose logs app` 多半是 `ADMIN_PASSWORD` 少于 8 位 |
| 报数据库连接失败 | 确认 `.env` 里 `POSTGRES_PASSWORD` 与 compose 一致；改过密码需 `docker compose down -v` 后重建（会清库，慎用于有数据的环境） |
| `SSL connection is required` | 说明连成了云端库，检查 `DATABASE_URL`；内网应为 `postgres://booth:...@db:5432/booth` |
| 端口打不开 | `HOST_PORT` 被占用或 NAS 防火墙；换端口或放行 |
| 页面 404 | 确认 `public/` 目录已随代码上传完整（含 `vendor/`） |

健康检查端点：`http://NAS内网IP:3000/api/health`
