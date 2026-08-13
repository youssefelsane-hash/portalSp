#!/usr/bin/env bash
# بيتشغّل في كل مرة الـCodespace يبدأ/يرجع يفتح (postStartCommand) — idempotent، مش بيكرر
# تشغيل حاجة شغالة بالفعل. مسؤوليته: التأكد إن infra + api + admin شغالين، من غير ما يوقف
# على أي فشل (set -e ممنوعة هنا عمدًا، عكس setup.sh).
cd "$(dirname "${BASH_SOURCE[0]}")/.."
export PATH="$PATH:/opt/flutter/bin"
mkdir -p /tmp/baytak-logs

echo "==> التأكد إن Postgres/Redis/MinIO شغالين ..."
(cd infra/docker && docker compose up -d) >/tmp/baytak-logs/docker-compose.log 2>&1

if ! curl -sSf http://localhost:3000/api/v1/health >/dev/null 2>&1; then
  echo "==> تشغيل apps/api ..."
  (
    cd apps/api
    set -a; source .env; set +a
    node ../../infra/migrations/migrate.js >/tmp/baytak-logs/migrate.log 2>&1 || true
    nohup npm run start:dev >/tmp/baytak-logs/api.log 2>&1 &
    disown
  )
else
  echo "==> apps/api شغال بالفعل."
fi

if ! curl -sSf http://localhost:3001 >/dev/null 2>&1; then
  echo "==> تشغيل apps/admin ..."
  (
    cd apps/admin
    nohup npm run dev >/tmp/baytak-logs/admin.log 2>&1 &
    disown
  )
else
  echo "==> apps/admin شغال بالفعل."
fi

echo "==> خلصنا. اللوجات في /tmp/baytak-logs/ لو حصل أي مشكلة (api.log, admin.log)."
echo "==> لوجات apps/api فيها كود التحقق (OTP) لما تسجّل دخول — 'grep OTP /tmp/baytak-logs/api.log'."
