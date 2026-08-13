#!/usr/bin/env bash
# جزء من إعداد GitHub Codespaces — بيتشغّل مرة واحدة بس وقت إنشاء الـCodespace (postCreateCommand).
# الهدف: تجربة كاملة للمشروع من غير أي تنصيب على جهاز المستخدم — كل حاجة هنا جوّه الـCodespace.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

FLUTTER_VERSION="3.44.9"

echo "==> [1/6] تثبيت Flutter SDK (${FLUTTER_VERSION}, stable) ..."
if [ ! -d /opt/flutter ]; then
  curl -fsSL -o /tmp/flutter.tar.xz \
    "https://storage.googleapis.com/flutter_infra_release/releases/stable/linux/flutter_linux_${FLUTTER_VERSION}-stable.tar.xz"
  sudo mkdir -p /opt
  sudo tar xf /tmp/flutter.tar.xz -C /opt
  sudo chown -R "$(whoami)" /opt/flutter
  rm -f /tmp/flutter.tar.xz
fi
export PATH="$PATH:/opt/flutter/bin"
grep -qxF 'export PATH="$PATH:/opt/flutter/bin"' ~/.bashrc || echo 'export PATH="$PATH:/opt/flutter/bin"' >> ~/.bashrc
git config --global --add safe.directory /opt/flutter
flutter config --enable-web --no-analytics >/dev/null
flutter precache --web >/dev/null

echo "==> [2/6] تشغيل Postgres/PostGIS + Redis + MinIO عبر Docker ..."
(cd infra/docker && docker compose up -d)

echo "==> [3/6] تجهيز ملفات .env (القيم الافتراضية بتشتغل مع Docker Compose فوق من غير أي تعديل) ..."
[ -f apps/api/.env ] || cp apps/api/.env.example apps/api/.env
[ -f apps/admin/.env.local ] || cp apps/admin/.env.example apps/admin/.env.local

echo "==> [4/6] تثبيت حزم npm لكل الـworkspaces (api + admin + packages) ..."
npm install

echo "==> [5/6] استنى Postgres يخلص healthcheck ..."
for i in $(seq 1 30); do
  status=$(docker inspect --format='{{.State.Health.Status}}' baytak-db 2>/dev/null || echo "starting")
  [ "$status" = "healthy" ] && break
  sleep 2
done

echo "==> [6/6] تطبيق الـmigrations ..."
(cd apps/api && set -a && source .env && set +a && node ../../infra/migrations/migrate.js)

echo ""
echo "==================================================================="
echo "الإعداد خلص. الـapi والأدمن هيشتغلوا تلقائيًا (راجع .devcontainer/start.sh)."
echo "لتطبيقات Flutter (اختياري، شغّلهم يدويًا وقت ما تحتاجهم):"
echo "  cd apps/customer-app && flutter pub get && flutter run -d web-server --web-port=8090 --web-hostname=0.0.0.0"
echo "  cd apps/technician-app && flutter pub get && flutter run -d web-server --web-port=8091 --web-hostname=0.0.0.0"
echo "==================================================================="
