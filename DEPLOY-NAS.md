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

## 六、把 Render 上的老数据迁过来（一键脚本）

仓库里已提供 `migrate-to-nas.sh`，它会：导出云端 → 停应用 → 导入本地 → 重启 → 打印数据量校验。
**导出环节借用临时 Postgres 容器，NAS 上不需要安装数据库客户端。**

### 1) 拿到 Neon 连接串

登录 Render 控制台 → 你的 booth-collect 服务 → **Environment** 里找到 `DATABASE_URL`，形如：

```
postgresql://用户名:密码@ep-xxx-xxx.neon.tech/neondb
```

### 2) 在 NAS 上执行迁移

```bash
cd /vol1/1000/docker/booth-collect
chmod +x migrate-to-nas.sh

export NEON_URL="postgresql://用户名:密码@ep-xxx.neon.tech/neondb?sslmode=require"
./migrate-to-nas.sh
```

> ⚠️ `NEON_URL` 末尾一定要带 `?sslmode=require`，Neon 强制 SSL，否则连不上。

脚本执行完会输出：

```
 勘测记录 booth_surveys : 23
 邀请码   invite_codes  : 8
 备份文件               : booth-20261027-153000.dump
```

### 3) 校验

1. 打开 `http://NAS内网IP:3000/admin` 登录后台
2. 抽查几条记录：**字段是否完整、照片能否正常显示**
3. 对比云端后台的记录条数是否一致

### 4) 出问题怎么办

- 脚本中途失败：**原始备份 `.dump` 文件仍在目录里**，修好问题重跑即可，云端数据不受影响（脚本只读）
- 想推倒重来：确保已有 `.dump` 备份后，`docker compose down && rm -rf ./data/postgres` 清空本地库再重导
  （**注意：compose 用的是目录挂载 `./data/postgres`，不是 Docker 命名卷，所以 `down -v` 清不掉数据**）

> 若脚本因网络下载不了 postgres 镜像，可先 `docker pull postgres:16-alpine`。

---

## 七、外网访问（让客户能直接打开填写）

**需求前提**：客户是外部人员，不可能装 VPN，所以必须给一个**公开 HTTPS 域名**。
推荐 **Cloudflare Tunnel**：免费、无需公网 IP、自带 HTTPS（自动证书）、NAS 真实 IP 不暴露。

### 方案 A：Cloudflare Tunnel（推荐）

**准备**：一个域名（任意注册商均可，.com/.cn 每年几十元）。

**一次性配置：**

1. 注册 Cloudflare，把域名接入（按向导改域名的 NS 服务器为 Cloudflare 提供的两个）
2. 进入 Cloudflare **Zero Trust** → **Networks** → **Tunnels** → **Create a tunnel**
3. 类型选 **Cloudflared**，起个名字（如 `booth-nas`）
4. 创建后会给一串 **tunnel token**（很长的一串字符），复制保存
5. 在 **Public Hostname** 页签添加：
   - Subdomain：`survey`（或你想要的前缀）
   - Domain：选你的域名
   - Service → Type：`HTTP`，URL：`app:3000`
   - （`app` 是 compose 里的服务名，容器间可直接用服务名互访）

**在 NAS 上启用：**

```bash
cd /vol1/1000/docker/booth-collect
vi .env                      # 填入刚复制的 token
# TUNNEL_TOKEN=eyJhIjoiXXXXXXXX...

docker compose --profile tunnel up -d
```

之后客户访问：`https://survey.你的域名.com/?code=邀请码`
后台：`https://survey.你的域名.com/admin`

> Tunnel 用了 `profiles`，纯内网使用时这条命令不会启动它，没有任何额外开销。

**验证**：`docker compose ps` 应看到 `booth-tunnel` 为 Up；Cloudflare 控制台里 Tunnel 状态显示 **Healthy**。

### 方案 B：有公网 IP 时（路由器端口转发）

1. 路由器把外网端口（如 8080）转发到 NAS 的 `HOST_PORT`
2. 配 DDNS（阿里云/花生壳等）拿到固定域名
3. 强烈建议套一层 HTTPS（可用 Nginx Proxy Manager 容器，自动签发证书）

不如 Tunnel 省事，且会把 NAS 端口直接暴露在公网，仅在方便时使用。

### 开放外网后必做

- `ADMIN_PASSWORD` 改成强密码（≥12 位，含大小写数字符号）
- 客户的填写链接走邀请码，**不要随意传播后台地址 `/admin`**
- 定期检查 `docker compose logs app` 有无异常请求

---

## 八、出问题怎么查

| 现象 | 原因 / 处理 |
|---|---|
| 容器起来就退出 | `docker compose logs app` 多半是 `ADMIN_PASSWORD` 少于 8 位 |
| 报 `password authentication failed for user "booth"` | `.env` 改过 `POSTGRES_PASSWORD`，但旧库里存的仍是老密码。Postgres 只在数据目录为空时才用新密码初始化。需清空数据目录重建（会清库，有数据先别用）：`docker compose down && rm -rf ./data/postgres && docker compose up -d` |
| `SSL connection is required` | 说明连成了云端库，检查 `DATABASE_URL`；内网应为 `postgres://booth:...@db:5432/booth` |
| 端口打不开 | `HOST_PORT` 被占用或 NAS 防火墙；换端口或放行 |
| 页面 404 | 确认 `public/` 目录已随代码上传完整（含 `vendor/`） |

健康检查端点：`http://NAS内网IP:3000/api/health`

---

## 九、迁移完成后：暂停 Render

确认 NAS 端一切正常后，再停云端，避免双写。

1. 登录 [Render Dashboard](https://dashboard.render.com)
2. 进入 booth-collect 服务 → **Settings**
3. 拉到最下方 **Suspend Service**（暂停，可随时恢复）或 **Delete**（彻底删除）
4. 若绑定了自定义域名，记得把 DNS 指向改到 NAS / Cloudflare Tunnel

> **建议先 Suspend 观察一周**，确认 NAS 端稳定运行、备份正常后再考虑删除。
> Neon 免费库会继续保留，即使 Render 暂停，数据仍可随时再导出一次。

---

## 十、切换检查清单

按这个顺序走，不容易漏：

- [ ] NAS 上 `docker compose ps` 两个容器均为 `Up (healthy)`
- [ ] `curl http://NAS内网IP:3000/api/health` 返回 `{"status":"ok"}`
- [ ] 内网能打开填写页和后台
- [ ] 执行 `migrate-to-nas.sh` 完成数据迁移
- [ ] 后台抽查记录条数、字段、**照片**均正常
- [ ] 配置 Cloudflare Tunnel，外网用域名能打开
- [ ] 用手机流量（不走 WiFi）实测一次外网填写并提交
- [ ] 改强 `ADMIN_PASSWORD`
- [ ] 设置定期备份（每周一次 `pg_dump` 或整卷 tar）
- [ ] **暂停 Render 服务**（先 Suspend 观察）
- [ ] 一周后确认稳定，保留一份 `.dump` 备份在 NAS 之外的地方
