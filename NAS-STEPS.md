# booth-collect 部署到 FNOS NAS —— 手把手操作步骤

按本文从上往下执行即可。**每条命令后面都写了「应该看到什么」**，对不上就停下来看该节的故障处理。

全程大约 30–40 分钟，其中大部分时间是在等镜像下载和构建。

---

## 第 0 步：开始前先准备这三样东西

请在动手之前把下面三项信息准备好，后面每一步都要用：

| # | 要准备的东西                     | 怎么拿到                                             | 填在这里备用               |
| - | -------------------------- | ------------------------------------------------ | -------------------- |
| 1 | NAS 的内网 IP                 | FNOS 设置 → 网络信息                                   | `192.168.__2_._30__` |
| 2 | Render 上的 Neon 数据库连接串      | Render 控制台 → 你的服务 → Environment → `DATABASE_URL` | 见下方说明                |
| 3 | 一个 Cloudflare Tunnel Token | 见第 6 步（外网时才需要）                                   | 后面再填                 |

> **第 2 项的连接串长这样**，复制出来备用（注意结尾要手动补上 `?sslmode=require`）：
>
> ```
> postgresql://用户名:密码@ep-xxx-xxx.neon.tech/neondb?sslmode=require
> ```

### 0.1 开启 NAS 的 SSH

FNOS 桌面 → **设置** → **系统**（部分版本叫「终端」）→ 打开 **SSH** 开关。

> 如果这个开关有安全提示，选择「允许密码登录」即可。

### 0.2 确认 Docker 已就绪

先用 SSH 登录测试（Windows 上用 PowerShell 或 cmd 即可，无需额外软件）：

```bash
ssh 你的用户名@你的NAS内网IP
```

首次连接会问 `Are you sure you want to continue connecting`，输入 `yes` 回车。

登录后执行：

```bash
sudo -i
docker --version
docker compose version
```

**应该看到：**

```
Docker version 27.x.x, build xxxxx
Docker Compose version v2.x.x
```

**如果出现 `command not found`：** FNOS 应用中心里没启用 Docker。去「应用中心」搜索 Docker 安装启用后，重新登录 SSH 再试。

> ⚠️ 如果 Docker Compose 版本是 v1（显示成 `docker-compose version 1.x`），本文所有  
> `docker compose`（带空格）命令都要改成 `docker-compose`（带横杠）。

---

## 第 1 步：把代码放到 NAS 上

### 1.1 创建目录

```bash
mkdir -p /vol1/1000/docker/booth-collect
cd /vol1/1000/docker/booth-collect
```

> `/vol1/1000` 是 FNOS 的默认存储池路径。如果你的 NAS 用了别的盘，  
> 可以在 FNOS 的「文件管理」里右键任意文件夹看属性，把路径替换成你自己的。

### 1.2 下载代码（推荐方式：NAS 上直接拉）

```bash
curl -L -o booth.zip https://codeload.github.com/McAli-713/booth-collect/zip/refs/heads/main
unzip -q booth.zip && mv booth-collect-main/* . && rm -rf booth-collect-main booth.zip
ls -la
```

**应该看到**这些文件都在：

```
Dockerfile
docker-compose.yml
.env.example
.gitignore
package.json
package-lock.json
server.js
db.js
migrate-to-nas.sh
public/
```

**如果 `unzip` 命令不存在：**

```bash
apt-get update && apt-get install -y unzip
```

> ✅ **为什么推荐这种方式而不是从你电脑上打包上传？**  
> 在 Windows 上打包会产生 CRLF 换行符，传到 Linux 上会让 `.env` 里的密码末尾混入  
> 一个看不见的回车，导致「数据库连接失败」但报错信息完全看不出原因，  
> `.sh` 脚本也会报 `$'\r': command not found`。直接从 GitHub 拉可以绕开这个坑。

**备选：如果 NAS 访问 GitHub 不通**，就在你电脑上把整个 `booth-collect` 目录打包成 zip，  
通过 FNOS 文件管理器上传到 `/vol1/1000/docker/` 再解压。解压后额外执行一次 LF 转换：

```bash
cd /vol1/1000/docker/booth-collect
which dos2unix >/dev/null 2>&1 && dos2unix Dockerfile docker-compose.yml .env.example migrate-to-nas.sh || \
  sed -i 's/\r$//' Dockerfile docker-compose.yml .env.example migrate-to-nas.sh
```

---

## 第 2 步：配置 `.env`（只需改两处）

```bash
cp .env.example .env
vi .env
```

> 不习惯 `vi`？按 `i` 进入编辑，改完后按 `Esc`，输入 `:wq` 回车保存退出。  
> 也可以在电脑上用记事本改好，通过 FNOS 文件管理器上传覆盖。

**必须改的两行：**

```env
POSTGRES_PASSWORD=换成你的强密码          # 例如 Kd82#mQp9!!
ADMIN_PASSWORD=后台登录密码至少8位        # 例如 Booth2026!Admin
```

**应该保留默认的地方：**

```env
ADMIN_USERNAME=CR001        # 保持不变
HOST_PORT=3000              # 若端口冲突再改
TUNNEL_TOKEN=               # 第 6 步再填
```

> ⚠️ 两个密码**必须不同**，且记牢：
>
> - `POSTGRES_PASSWORD` 是数据库内部用的，你平时不会用到，忘了要重建数据库
> - `ADMIN_PASSWORD` 是你登录后台 `CR001` 账号用的密码
>
> ⚠️ `ADMIN_PASSWORD` 少于 8 位时应用会**拒绝启动**，这是代码的刻意保护。

**检查一下有没有多余符号**（很重要）：

```bash
cat -A .env | grep POSTGRES_PASSWORD
```

应该显示 `POSTGRES_PASSWORD=你的密码$`，末尾是 `$`（换行符）。  
**如果看到 `^M$`**，说明混入了回车，执行第 1.2 节末尾那条 `sed` 命令修掉。

---

## 第 3 步：启动

```bash
docker compose up -d --build
```

首次会拉取 node/postgres 镜像并执行 `npm ci`，**约 2–5 分钟**，期间会刷很多日志。

**最后应该看到：**

```
[+] Running 3/3
 ✔ Network booth-collect_default    Created
 ✔ Container booth-db               Healthy
 ✔ Container booth-app              Started
```

> 注意 `booth-db` 显示的是 **Healthy** —— compose 里配置了「等数据库真正就绪才启动应用」，  
> 这个位置如果直接跳到 Started，后面可能出现应用先起来、连不上库的情况。

---

## 第 4 步：内网验证（先别急着迁移）

### 4.1 容器状态

```bash
docker compose ps
```

**应该看到两行都是 Up：**

```
NAME        STATUS                    PORTS
booth-app   Up (healthy)              0.0.0.0:3000->3000/tcp
booth-db    Up (healthy)              5432/tcp
```

> 如果 STATUS 是 `Restarting` 或直接没有 `booth-app`，跳到文末「故障排查」。

### 4.2 健康检查

```bash
curl http://127.0.0.1:3000/api/health
```

**应该返回：**

```json
{"status":"ok","timestamp":"2026-10-27T...","database":"connected"}
```

### 4.3 浏览器打开

在你电脑上打开这两个地址：

- 后台： `http://你的NAS内网IP:3000/admin`
- 填写页： `http://你的NAS内网IP:3000/`

用 `CR001` 和第 2 步设的 `ADMIN_PASSWORD` 登录后台，此时后台应该是空的。

**到这一步，一个全新的 NAS 版系统就跑起来了。** 可以先在后台建一个邀请码，  
用手机连 WiFi 试着提交一条测试记录，确认照片上传正常。

---

## 第 5 步：把云端数据搬过来

### 5.1 执行迁移

```bash
cd /vol1/1000/docker/booth-collect
chmod +x migrate-to-nas.sh

export NEON_URL="postgresql://用户名:密码@ep-xxx.neon.tech/neondb?sslmode=require"
./migrate-to-nas.sh
```

> ⚠️ `NEON_URL` 末尾**必须**带 `?sslmode=require`，Neon 强制 SSL，漏了会连接被拒。  
> ⚠️ 如果密码里含有 `@`、`#`、`$` 等特殊字符，会与 URL 语法冲突。  
> 遇到报错就把特殊字符做 URL 编码（`@` → `%40`、`#` → `%23`、`$` → `%24`）。

脚本会自动走完五个阶段，**你应该看到类似这样的输出**：

```
==========================================
 booth-collect 数据迁移  20261027-164500
==========================================

[1/5] 从云端 Neon 导出数据 ...
      导出成功：booth-20261027-164500.dump (48M)

[2/5] 停止应用容器（防止迁移过程中继续写入）...

[3/5] 启动本地数据库并等待就绪...
      数据库已就绪

[4/5] 导入到本地数据库...
      导入完成

[5/5] 启动应用并校验...

==========================================
 迁移完成
   勘测记录 booth_surveys : 23
   邀请码   invite_codes  : 8
   备份文件               : booth-20261027-164500.dump
==========================================
```

### 5.2 对比数量、抽查照片

1. 先看云端 Render 后台里有多少条记录，和上面输出的 `booth_surveys` 数字是否一致
2. 打开 NAS 后台 `http://NAS内网IP:3000/admin`，**点开几条有照片的记录**  
   确认照片能显示（这是最关键的检查，照片以 base64 存在库里）
3. 随便导一条 PDF，确认功能正常

> **脚本对云端只读**，中途失败不会破坏云端数据。备份 `.dump` 文件会留在目录里，  
> 修好问题直接重跑即可。确认没问题之前**不要删这个 `.dump`**。

---

## 第 6 步：配置外网访问（Cloudflare Tunnel）

### 6.1 Cloudflare 后台（一次性）

1. 注册 Cloudflare，把你的域名按向导接入（改域名的 NS 服务器）
2. 左侧 **Zero Trust** → **Networks** → **Tunnels** → **Create a tunnel**
3. 类型选 **Cloudflared**，名字填 `booth-nas`，保存
4. 页面上会给出一长串 **token**，复制保存好
5. 在 **Public Hostname** 页签点 Add：
   - Subdomain： `survey`
   - Domain： 选你的域名
   - Service → Type： `HTTP`
   - Service → URL： **`app:3000`**  
     （`app` 是 compose 里的服务名，容器之间可以直接用服务名互访）

### 6.2 NAS 上启用

```bash
cd /vol1/1000/docker/booth-collect
vi .env
```

把刚复制的 token 填进去：

```env
TUNNEL_TOKEN=eyJhIjoiXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

然后启动隧道：

```bash
docker compose --profile tunnel up -d
```

### 6.3 验证

```bash
docker compose ps
```

**应该看到 booth-tunnel 也是 Up：**

```
NAME           STATUS         PORTS
booth-app      Up (healthy)
booth-db       Up (healthy)
booth-tunnel   Up
```

Cloudflare 控制台里 Tunnel 状态应显示 **Healthy**（可能需要等 1 分钟）。

用**手机关闭 WiFi、走流量**打开 `https://survey.你的域名.com/admin`，确认能登录。

> 隧道服务用了 Docker 的 profile 隔离，**不敲 `--profile tunnel` 它就不会启动**，  
> 纯内网使用完全没影响。

### 6.4 开放外网后必做

```bash
cd /vol1/1000/docker/booth-collect
vi .env               # 把 ADMIN_PASSWORD 改成 ≥12 位强密码
docker compose up -d  # 让新密码生效
```

- 客户的填写链接是 `https://survey.你的域名.com/?code=邀请码`
- 后台地址 `/admin` **不要对外传播**

---

## 第 7 步：设置定期备份（重要，别跳过）

照片是 base64 存在数据库里的，**数据库就是你的全部家当**。

### 建备份脚本

```bash
mkdir -p /vol1/1000/backup/booth
cat > /vol1/1000/docker/booth-collect/backup.sh <<'EOF'
#!/usr/bin/env bash
cd /vol1/1000/docker/booth-collect
docker exec -t booth-db pg_dump -U booth -d booth -Fc \
  > /vol1/1000/backup/booth/booth-$(date +%Y%m%d).dump
# 只保留最近 30 天的备份
find /vol1/1000/backup/booth -name "booth-*.dump" -mtime +30 -delete
EOF
chmod +x /vol1/1000/docker/booth-collect/backup.sh
```

### 试跑一次

```bash
/vol1/1000/docker/booth-collect/backup.sh
ls -lh /vol1/1000/backup/booth/
```

**应该看到一个几 MB 到几十 MB 的 `.dump` 文件。**

### 加定时任务（每周日凌晨 3 点）

```bash
crontab -e
```

加入这一行：

```
0 3 * * 0 /vol1/1000/docker/booth-collect/backup.sh
```

> 建议再把这个备份目录同步一份到 NAS 之外的地方（移动硬盘、网盘、另一台机器）。  
> NAS 硬盘坏了的时候，本地备份救不了你。

**恢复方法**（真要用的时候）：

```bash
docker compose stop app
docker exec -i booth-db pg_restore -U booth -d booth --clean --if-exists --no-owner \
  < /vol1/1000/backup/booth/booth-20261027.dump
docker compose start app
```

---

## 第 8 步：停用 Render

**确认 NAS 端稳定运行至少一周再删**，建议先 Suspend（暂停），随时可恢复。

1. 登录 [Render Dashboard](https://dashboard.render.com)
2. 进入 booth-collect 服务 → **Settings**
3. 拉到最底部 → **Suspend Service**
4. 如果在 Render 绑了自定义域名，把 DNS 指向改到 Cloudflare Tunnel

> Neon 免费库不受影响，即使 Render 停了，云端数据仍可随时再导出一次  
> （就是第 5 步那条命令）。这是你的后悔药。

---

## 日常运维命令速查

```bash
cd /vol1/1000/docker/booth-collect

docker compose ps                  # 看状态
docker compose logs -f app         # 看应用日志（Ctrl+C 退出）
docker compose restart app         # 重启应用
docker compose stop                # 停止
docker compose start               # 启动
docker compose down                # 删除容器（数据卷保留，记录不丢）

# 代码有更新时
curl -L -o /tmp/b.zip https://codeload.github.com/McAli-713/booth-collect/zip/refs/heads/main
unzip -qo /tmp/b.zip && cp -r booth-collect-main/. . && rm -rf booth-collect-main /tmp/b.zip
docker compose up -d --build
```

> 注意更新时**不要覆盖 `.env`** —— 上面的 `cp -r` 会带上 `.env.example`，  
> 但不会覆盖已存在的 `.env`（`-o` 只覆盖同名文件中较新的，GitHub 上的 example 不含你的密码）。  
> 保险起见更新前先备份：`cp .env .env.bak`

---

## 故障排查

| 现象                                    | 原因和处理                                                                                                |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `booth-app` 一直 Restarting             | 看 `docker compose logs app`，**九成是 `ADMIN_PASSWORD` 少于 8 位**                                          |
| 日志报 `password authentication failed for user "booth"` | `.env` 改过 `POSTGRES_PASSWORD`，但旧库里存的仍是老密码（Postgres 只在数据目录为空时才用新密码初始化）。清空数据目录重建：`docker compose down && rm -rf ./data/postgres && docker compose up -d`（会清空本地库，有数据先别用）。**注意 `down -v` 无效**——compose 用的是目录挂载 `./data/postgres`，不是 Docker 命名卷 |
| 报 `SSL connection is required`        | 说明连到了云端库。检查 compose 里 `DATABASE_URL` 是否为 `postgres://booth:...@db:5432/booth`                        |
| 端口打不开、浏览器拒绝连接                         | `HOST_PORT` 被占用 → 改成 8080；或 NAS 防火墙未放行该端口                                                            |
| 页面能开但样式错乱/404                         | `public/` 目录不完整（缺 `vendor/`、`images/`），重新下载代码                                                        |
| `migrate-to-nas.sh` 报 "请先设置 NEON_URL" | 忘了 `export`，或用了 `sudo` 导致环境变量丢失。用 `sudo -i` 后再 export                                                |
| 迁移脚本在导出阶段失败                           | 多半是 `NEON_URL` 缺 `?sslmode=require`，或密码含特殊字符未做 URL 编码                                                |
| Tunnel 起不来                            | `docker compose logs tunnel` → 通常是 token 复制不完整（注意别多复制空格或换行）                                          |

**一键自查**（遇到问题时先跑一遍）：

```bash
cd /vol1/1000/docker/booth-collect
docker compose ps
echo "--- app 日志最后 20 行 ---"
docker compose logs --tail=20 app
echo "--- 健康检查 ---"
curl -s http://127.0.0.1:3000/api/health
```

把这三段的输出发出来，基本就能定位了。
