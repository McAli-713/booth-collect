#!/usr/bin/env bash
# ==============================================================
# booth-collect：云端 Neon → NAS 本地 Postgres 数据迁移
#
# 用法（在 docker-compose.yml 所在目录执行）：
#   chmod +x migrate-to-nas.sh
#   NEON_URL="postgresql://user:pass@ep-xxx.neon.tech/neondb?sslmode=require" ./migrate-to-nas.sh
#
# 说明：
#   - 导出环节借用临时 postgres 容器执行 pg_dump，NAS 上无需安装 Postgres 客户端
#   - 迁移期间会先停 app，避免新旧两端同时写入导致数据不一致
# ==============================================================
set -euo pipefail

cd "$(dirname "$0")"

if [[ -z "${NEON_URL:-}" ]]; then
  echo "❌ 请先设置 NEON_URL 环境变量"
  echo "   例：export NEON_URL=\"postgresql://user:pass@ep-xxx.neon.tech/neondb?sslmode=require\""
  echo "   连接串可在 Render 项目的环境变量 DATABASE_URL 里找到"
  exit 1
fi

DB_CONTAINER="${DB_CONTAINER:-booth-db}"
DB_USER="${DB_USER:-booth}"
DB_NAME="${DB_NAME:-booth}"
STAMP="$(date +%Y%m%d-%H%M%S)"
DUMP="booth-${STAMP}.dump"

echo "=========================================="
echo " booth-collect 数据迁移  ${STAMP}"
echo "=========================================="

# ---------- 1) 从云端导出 ----------
echo ""
echo "[1/5] 从云端 Neon 导出数据 ..."
docker run --rm -v "$(pwd):/d" -w /d postgres:16-alpine \
  pg_dump "${NEON_URL}" --format=custom --no-owner --file="/d/${DUMP}"

if [[ ! -s "${DUMP}" ]]; then
  echo "❌ 导出失败：${DUMP} 为空。请检查 NEON_URL 是否正确、云端库是否可访问。"
  exit 1
fi
DUMP_SIZE="$(du -h "${DUMP}" | cut -f1)"
echo "      导出成功：${DUMP} (${DUMP_SIZE})"

# ---------- 2) 停应用，避免迁移期间写入 ----------
echo ""
echo "[2/5] 停止应用容器（防止迁移过程中继续写入）..."
docker compose stop app || true

# ---------- 3) 确保本地库就绪 ----------
echo ""
echo "[3/5] 启动本地数据库并等待就绪..."
docker compose up -d db

for i in $(seq 1 60); do
  if docker exec "${DB_CONTAINER}" pg_isready -U "${DB_USER}" -d "${DB_NAME}" >/dev/null 2>&1; then
    echo "      数据库已就绪"
    break
  fi
  if [[ $i -eq 60 ]]; then
    echo "❌ 数据库长时间未就绪，请检查 docker compose logs db"
    exit 1
  fi
  sleep 2
done

# ---------- 4) 导入 ----------
echo ""
echo "[4/5] 导入到本地数据库..."
docker cp "${DUMP}" "${DB_CONTAINER}":/tmp/restore.dump

# pg_restore 对已存在的对象会报可忽略的 NOTICE/ERROR，故不因单条错误中断
set +e
RESTORE_OUT="$(docker exec "${DB_CONTAINER}" \
  pg_restore -U "${DB_USER}" -d "${DB_NAME}" --clean --if-exists --no-owner \
  --format=custom /tmp/restore.dump 2>&1)"
RESTORE_RC=$?
set -e

docker exec "${DB_CONTAINER}" rm -f /tmp/restore.dump

if [[ ${RESTORE_RC} -ne 0 ]]; then
  echo "${RESTORE_OUT}" | tail -20
  echo ""
  echo "⚠️  pg_restore 返回非零。上述若仅为「对象不存在/NOTICE」可忽略；"
  echo "   若出现致命错误请人工确认。不要删除 ${DUMP}。"
else
  echo "      导入完成"
fi

# ---------- 5) 启动应用并校验 ----------
echo ""
echo "[5/5] 启动应用并校验..."
docker compose up -d

sleep 5
RECORDS="$(docker exec "${DB_CONTAINER}" psql -U "${DB_USER}" -d "${DB_NAME}" -tAc "SELECT COUNT(*) FROM booth_surveys" 2>/dev/null || echo '查询失败')"
INVITES="$(docker exec "${DB_CONTAINER}" psql -U "${DB_USER}" -d "${DB_NAME}" -tAc "SELECT COUNT(*) FROM invite_codes" 2>/dev/null || echo '查询失败')"

echo ""
echo "=========================================="
echo " 迁移完成"
echo "   勘测记录 booth_surveys : ${RECORDS}"
echo "   邀请码   invite_codes  : ${INVITES}"
echo "   备份文件               : ${DUMP}"
echo "=========================================="
echo ""
echo "下一步："
echo "  1) 浏览器打开后台 http://NAS内网IP:3000/admin 抽查几条记录与照片是否完整"
echo "  2) 确认无误后，到 Render 控制台暂停服务（见 DEPLOY-NAS.md 第九节）"
echo "  3) 迁移备份文件 ${DUMP} 请保留一段时间，确认稳定后再删除"
