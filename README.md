# 喷房现场勘测系统

一个基于 Node.js + PostgreSQL 的喷房现场勘测数据采集系统，支持邀请码专属链接、移动端表单提交（含现场照片）、管理后台查看、二维码分享、Excel 导出和邮件通知。

## 技术栈
- **后端**: Node.js + Express
- **数据库**: PostgreSQL (Supabase 免费版)
- **前端**: 原生 HTML/CSS/JS（无需构建）
- **邮件**: Resend（免费 3000 封/月）
- **部署**: Render 免费 Web Service

## 功能
- 邀请码管理：为每个客户生成专属勘测链接和二维码
- 喷房现场勘测数据采集（中英文双语表单，含现场概述、控制柜安装、小门尺寸、墙面烤灯、气源电源、内部尺寸、地坑尺寸等）
- 各测量项附带示例参考图，点击可放大查看
- 现场照片上传（喷房全景、气源点位、电源点位，自动压缩）
- 条件选填模块（电梯/烤灯/水泥墩/斜坡，选择"有"后显示对应字段）
- 管理后台（Basic Auth 认证，默认账号 CR001 / 1234）
- 数据分页浏览、详情查看（照片按测量项分类展示，而非统一放底部）
- 详情页一键导出 PDF
- Excel 导出
- 新记录邮件通知
- 移动端友好的表单界面

---

## 部署步骤（零成本方案）

### 第一步：创建 Supabase 数据库
1. 访问 https://supabase.com ，注册/登录
2. 点击 **New Project**
3. 填写项目信息：
   - Name: `spray-booth-db`
   - Database Password: 设置一个强密码（记下来，后面要用）
   - Region: 选离你近的（如 Singapore / Tokyo）
   - Plan: Free
4. 等待项目创建完成（约 1-2 分钟）
5. 进入项目 → 左侧菜单 **Project Settings** → **Database**
6. 找到 **Connection string** → 选择 **URI** 格式
7. 复制连接字符串，把 `[YOUR-PASSWORD]` 替换成你刚才设置的密码
   - 格式类似：`postgresql://postgres:你的密码@db.xxxx.supabase.co:5432/postgres`

> 免费版限制：500MB 数据库、最多 2 个项目、7 天无活动会暂停（手动恢复即可，数据不丢）

---

### 第二步：部署到 Render
1. 把本项目代码推送到 GitHub 仓库
2. 访问 https://render.com ，注册/登录（用 GitHub 账号）
3. 点击 **New +** → **Web Service**
4. 选择你刚才的 GitHub 仓库
5. 填写配置：
   - **Name**: `booth-collect`（随便起）
   - **Region**: 选 Singapore（离国内近）
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `node --dns-result-order=ipv4first server.js`
   - **Instance Type**: Free（免费）
6. 点击 **Advanced** → **Add Environment Variable**，添加以下变量：

   | Key | Value |
   |-----|-------|
   | `DATABASE_URL` | 第一步从 Supabase 复制的连接字符串 |
   | `ADMIN_USERNAME` | 管理后台用户名，默认 `CR001` |
   | `ADMIN_PASSWORD` | **⚠️ 必填，至少 8 位强密码**（无默认值，不设置服务无法启动） |
   | `RESEND_API_KEY` | （可选）Resend API Key，见第三步 |
   | `NOTIFICATION_EMAIL` | （可选）接收通知的邮箱 |

7. 点击 **Create Web Service**，等待部署完成（约 2-3 分钟）
8. 部署成功后，Render 会给你一个域名，如 `https://booth-collect.onrender.com`

> 免费版限制：15 分钟无访问会休眠，下次访问冷启动约 10-30 秒；每月 750 小时运行时长
> 注意：Start Command 必须加 `--dns-result-order=ipv4first`，否则 Supabase 连接会因 IPv6 失败

---

### 第三步（可选）：配置 Resend 邮件通知
1. 访问 https://resend.com ，注册/登录
2. 左侧菜单 **API Keys** → **Create API Key**
3. 名字随便起，权限选 `Full access`，创建后复制 Key
4. 免费版：3000 封/月，每天最多 100 封
5. 回到 Render，在环境变量中填入：
   - `RESEND_API_KEY`: 你复制的 Key
   - `NOTIFICATION_EMAIL`: 接收通知的邮箱地址

> 注意：免费版发件人是 `onboarding@resend.dev`，只能发给你注册 Resend 时用的邮箱。要发给其他邮箱需要验证自己的域名。

---

## 使用说明

### 邀请码管理
- 登录管理后台 → 「邀请码管理」标签页
- 点击「生成邀请码」，填写客户名称和描述
- 每个邀请码对应一个专属勘测链接和二维码，可发送给客户填写

### 表单提交页
- 访问：`https://你的域名.onrender.com/?code=邀请码`
- 客户在手机上填写喷房勘测数据并上传现场照片
- 表单字段：勘测名称、现场地址、车型、加热方式、气压温度、楼板厚度、楼层、电梯尺寸、地下管线、控制柜安装宽度、小门位置尺寸、墙面烤灯参数、气源电源位置及照片、喷房内部尺寸、地坑深度/宽度/水泥墩/斜坡等

### 管理后台
- 访问：`https://你的域名.onrender.com/admin`
- 输入你设置的 `ADMIN_USERNAME` / `ADMIN_PASSWORD` 登录
- 功能：查看所有勘测记录、查看详情（含照片预览）、删除记录、导出 Excel、管理邀请码

### Excel 导出
- 登录管理后台后，点击「导出 Excel」
- 导出所有记录，包含全部文本字段（照片以 base64 存储在数据库中，不导出到 Excel）

---

## 本地开发

```bash
# 安装依赖
npm install

# 复制环境变量文件并填写
cp .env.example .env

# 编辑 .env，填入 DATABASE_URL 等

# 启动
npm start
```

访问：
- 表单：http://localhost:3000/?code=测试邀请码
- 管理后台：http://localhost:3000/admin

---

## 项目结构

```
spray-booth-collector/
├── server.js          # 主服务入口（路由、中间件、邮件）
├── db.js              # 数据库连接和操作
├── package.json       # 依赖配置
├── render.yaml        # Render 部署配置
├── .env.example       # 环境变量示例
├── README.md          # 本文档
└── public/
    ├── index.html     # 喷房勘测表单页（含照片上传、条件选填）
    └── admin.html     # 管理后台（含二维码、照片预览）
```

---

## 常见问题

**Q: Render 免费版休眠后第一次访问很慢？**
A: 正常现象，冷启动约 10-30 秒。可以用 UptimeRobot 等免费监控服务每 5 分钟访问一次，保持唤醒。

**Q: Supabase 数据库被暂停了怎么办？**
A: 登录 Supabase 后台，点项目里的「Restore」按钮即可恢复，数据不会丢。

**Q: 表单字段能改吗？**
A: 可以。修改 `public/index.html` 的表单字段，同时修改 `db.js` 的 FIELDS 数组和表结构、`server.js` 的 EXPORT_COLUMNS。

**Q: 照片存在哪里？**
A: 照片在前端自动压缩（最大 1280px，质量 70%）后转 base64，存储在 PostgreSQL 的 `photos` 字段（TEXT 类型，JSON 数组格式）。

**Q: 能绑自己的域名吗？**
A: Render 免费版支持自定义域名，在项目设置 → Custom Domains 里添加，然后去域名服务商配 CNAME 解析。
