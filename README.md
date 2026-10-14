# 喷房现场勘测系统（v1.2.0 引导式分步版）

一个基于 Node.js + PostgreSQL 的喷房现场勘测数据采集系统，支持邀请码专属链接、移动端表单提交（含现场照片）、管理后台查看、二维码分享、Excel 导出和邮件通知。

## 技术栈
- **后端**: Node.js + Express
- **数据库**: PostgreSQL (Supabase / Neon)
- **前端**: 原生 HTML/CSS/JS（无需构建）
- **邮件**: Resend
- **部署**: Render Web Service

## v1.2.0 更新内容

### 引导式分步填写（核心新特性）
- 表单默认进入「引导模式」：测量项拆分为 8 个步骤（基本信息 → 控制柜与小门 → 墙面烤灯 → 气源与电源 → 喷房内部尺寸 → 地坑尺寸 → 现场照片 → 备注与确认），每步只聚焦当前任务，大幅降低单页信息密度
- 顶部步骤条实时显示进度与完成状态（✓），可点击已到达的步骤快速跳转，未到达步骤锁定
- 每步独立校验：必填项未完成无法进入下一步，错误字段标红 + 顶部错误汇总，点击可定位
- 顶部常驻「🧭 引导模式 / 📄 整页模式」切换按钮：两种模式数据完全互通，随时切换不丢失任何已填内容
- 步骤进度与模式偏好按邀请码本地记忆，意外关闭/刷新后重新打开自动恢复
- 引导模式下输入框回车 = 下一步；条件字段（电梯/烤灯/水泥墩/斜坡）选"无"自动跳过对应步骤
- 移动端步骤条横向可滑动，当前步骤自动滚动到可见区域

## v1.1.0 更新内容

### Bug 修复
- 修复邀请码大小写不一致导致的数据丢失和回填失败
- 修复 UPSERT 非原子操作导致的重复记录问题（新增唯一索引 + ON CONFLICT）
- 修复管理后台"本月新增"统计错误（改为后端全量统计）
- 修复更新记录时 `created_at` 被覆盖的问题（新增 `updated_at` 字段）
- 修复 `door_to_front_wall` / `light_to_grate_height` placeholder 为 "xxx" 的问题
- 修复 `switchTab` 依赖全局 `event` 对象导致 Firefox 报错
- 修复手机照片 EXIF 方向导致的旋转问题

### 安全加固
- 公开接口（校验邀请码、提交、保存草稿）新增速率限制（防枚举 / 防滥用）
- 服务端校验照片数量（最多15张）、单张大小和格式
- 新增 Content-Security-Policy (CSP) 响应头
- 第三方 JS 库全部本地化（去除 CDN 依赖）
- 数据库连接池显式配置（max=5，适配免费版连接数限制）
- 错误日志脱敏（不打印完整 err 对象）
- 分页参数上限保护（limit ≤ 200）

### 体验优化
- 表单页新增顶部进度条，实时显示填写进度
- 三大节支持折叠 / 展开（手风琴）
- 字段变化后 5 秒自动保存草稿（防抖）
- 照片上传显示处理进度，限制每类数量（喷房9张/气源3张/电源3张）
- 数字字段增加合理范围校验（min=0, max=100000）
- 条件字段切换为"无"时，如有已填内容会弹出确认
- 校验失败时顶部显示错误汇总，点击可跳转到对应字段
- 移动端优化：输入框 16px 防缩放、三列改两列、底部固定操作栏、安全区适配
- 示例图懒加载（loading="lazy"）
- 本地草稿暂存（localStorage），网络中断不丢数据
- 照片预览支持旋转
- 管理后台新增搜索（客户名/邀请码/勘测名/地址）和状态筛选
- 管理后台详情页支持编辑修改
- 管理后台支持批量选择和批量删除
- 删除操作改为自定义确认弹窗（重要删除需输入 DELETE）
- 全部 alert 替换为 Toast 提示
- 会话超时前 1 分钟弹出提醒，可延长
- 新增近 6 个月提交趋势图（纯 CSS 柱状图）
- 响应式适配平板和手机

## 功能
- 邀请码管理：为每个客户生成专属勘测链接和二维码
- 喷房现场勘测数据采集（中英文双语表单）
- 各测量项附带示例参考图，点击可放大查看
- 现场照片上传（自动压缩 + EXIF 方向校正）
- 条件选填模块（电梯/烤灯/水泥墩/斜坡）
- 管理后台（Basic Auth 认证 + 登录速率限制）
- 数据分页浏览、搜索筛选、详情查看与编辑
- 详情页导出 PDF
- Excel 导出（分批查询，避免大内存占用）
- 新记录邮件通知
- 移动端友好的表单界面

---

## 部署步骤

### 第一步：创建 PostgreSQL 数据库
1. 访问 https://supabase.com 或 https://neon.tech ，注册/登录
2. 创建新项目，获取数据库连接字符串（URI 格式）
3. 格式类似：`postgresql://postgres:你的密码@db.xxxx.supabase.co:5432/postgres`

### 第二步：部署到 Render
1. 把本项目代码推送到 GitHub 仓库
2. 访问 https://render.com ，点击 **New +** → **Web Service**
3. 选择 GitHub 仓库，填写配置：
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `node --dns-result-order=ipv4first server.js`
   - **Instance Type**: Free（免费）或 Starter
4. 添加环境变量：
   | Key | Value | 必填 |
   |-----|-------|------|
   | `DATABASE_URL` | 数据库连接字符串 | ✅ |
   | `ADMIN_USERNAME` | 管理后台用户名，默认 `CR001` | 可选 |
   | `ADMIN_PASSWORD` | **至少 8 位强密码**（不设置服务无法启动） | ✅ |
   | `RESEND_API_KEY` | Resend API Key | 可选 |
   | `NOTIFICATION_EMAIL` | 接收通知的邮箱 | 可选 |
5. 点击 **Create Web Service**，等待部署完成

> 注意：Start Command 必须加 `--dns-result-order=ipv4first`，否则 Supabase 连接可能因 IPv6 失败

### 第三步（可选）：配置 Resend 邮件通知
1. 访问 https://resend.com ，创建 API Key
2. 在 Render 环境变量中填入 `RESEND_API_KEY` 和 `NOTIFICATION_EMAIL`

---

## 使用说明

### 邀请码管理
- 登录管理后台 → 「邀请码管理」标签页
- 点击「生成邀请码」，填写客户名称和描述
- 每个邀请码对应一个专属勘测链接和二维码，可发送给客户填写

### 表单提交页
- 访问：`https://你的域名/?code=邀请码`
- 客户在手机上填写喷房勘测数据并上传现场照片
- 默认引导式分步填写（8 步），也可随时切换整页模式，两种模式数据互通
- 系统自动保存草稿，意外关闭后重新打开可恢复

### 管理后台
- 访问：`https://你的域名/admin`
- 输入 `ADMIN_USERNAME` / `ADMIN_PASSWORD` 登录
- 功能：搜索筛选、查看详情、编辑记录、批量删除、导出 Excel/PDF、管理邀请码

---

## 本地开发
```bash
npm install
cp .env.example .env
# 编辑 .env，填入 DATABASE_URL、ADMIN_PASSWORD 等
npm start
```
访问：
- 表单：http://localhost:3000/?code=测试邀请码
- 管理后台：http://localhost:3000/admin

## 项目结构
```
spray-booth-collector/
├── server.js          # 主服务入口（路由、中间件、限流、邮件）
├── db.js              # 数据库连接和操作（原子 UPSERT、分批查询）
├── package.json
├── render.yaml        # Render 部署配置
├── README.md
└── public/
    ├── index.html     # 喷房勘测表单页（引导分步/整页双模式、进度条、自动保存）
    ├── admin.html     # 管理后台（搜索、编辑、批量操作）
    ├── vendor/        # 第三方 JS 库（本地化）
    │   ├── qrcode-generator.min.js
    │   ├── html2canvas.min.js
    │   └── jspdf.umd.min.js
    └── images/        # 示例参考图
```

## 安全特性
- 强制管理员密码（≥8位），无默认弱密码
- 登录速率限制（15分钟内最多10次失败）
- 公开接口速率限制（防邀请码枚举）
- CORS 完全禁用（同源部署）
- CSP + X-Frame-Options + X-Content-Type-Options 安全响应头
- 所有 SQL 参数化查询（防注入）
- 前端用户输入全部 HTML 转义（防 XSS）
- 照片服务端校验（数量、大小、格式）
- 错误信息脱敏（不向客户端泄露内部细节）
- 邀请码使用 crypto 密码学安全随机生成
