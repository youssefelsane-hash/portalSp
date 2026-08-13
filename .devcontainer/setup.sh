#!/usr/bin/env bash
# جزء من إعداد GitHub Codespaces — بيتشغّل مرة واحدة بس وقت إنشاء الـCodespace (postCreateCommand).
# الهدف: تجربة كاملة للمشروع من غير أي تنصيب على جهاز المستخدم — كل حاجة هنا جوّه الـCodespace.
#
# ترتيب الخطوات مهم: apps/api و apps/admin (الأساسيين، اللي التجربة كلها متوقفة عليهم) لازم
# يخلصوا الأول ومحميين بـ set -e (فشل أي واحد فيهم = وقف واضح). تثبيت Flutter (اختياري، لتطبيقات
# العميل/الفني بس) اتنقل لآخر السكريبت ومعزول بمعالجة أخطاء خاصة بيه — فشله (نت متقطع مثلاً)
# ميوقفش/يمنعش تشغيل api/admin خالص، وهو بالظبط اللي حصل فعليًا أول مرة اتجرب فيها الـCodespace
# (set -e كانت شغالة والـFlutter كان أول خطوة، فأي فشل فيه كان بيلغي كل حاجة بعده).
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

echo "==> [1/5] تشغيل Postgres/PostGIS + Redis + MinIO عبر Docker ..."
(cd infra/docker && docker compose up -d)

echo "==> [2/5] تجهيز ملفات .env (القيم الافتراضية بتشتغل مع Docker Compose فوق من غير أي تعديل) ..."
[ -f apps/api/.env ] || cp apps/api/.env.example apps/api/.env
[ -f apps/admin/.env.local ] || cp apps/admin/.env.example apps/admin/.env.local

# بَقّة حقيقية اتلقطت أول تجربة Codespace حي فعلية: apps/admin بيستخدم NEXT_PUBLIC_API_URL في
# كود جافاسكريبت شغال جوّه متصفح المستخدم مباشرة (مش عن طريق سيرفر Next.js) لنداءات زي
# GET /auth/me بعد تسجيل الدخول — القيمة الافتراضية http://localhost:3000 معناها "لوكال هوست
# جهاز المستخدم نفسه" لما المتصفح ده فعليًا برّه الـCodespace (تاب Chrome عادي فاتح رابط
# forwarded https://...-3001.app.github.dev). النتيجة: كل نداء زي ده بيفشل بصمت برسالة عامة
# "حصل خطأ، حاول تاني" حتى لو تسجيل الدخول نفسه نجح فعلاً. الإصلاح: لو شغالين جوّه Codespace
# فعليًا (CODESPACES=true، متغيّر بيتحط تلقائيًا)، نبني رابط الـforward العام الصح لبورت 3000
# ونحطه بدل القيمة المحلية.
if [ "${CODESPACES:-false}" = "true" ] && [ -n "${CODESPACE_NAME:-}" ]; then
  FORWARD_DOMAIN="${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}"
  API_PUBLIC_URL="https://${CODESPACE_NAME}-3000.${FORWARD_DOMAIN}/api/v1"
  echo "    Codespace متعرّف عليه — NEXT_PUBLIC_API_URL هيتظبط على: ${API_PUBLIC_URL}"
  if grep -q '^NEXT_PUBLIC_API_URL=' apps/admin/.env.local; then
    sed -i "s#^NEXT_PUBLIC_API_URL=.*#NEXT_PUBLIC_API_URL=${API_PUBLIC_URL}#" apps/admin/.env.local
  else
    echo "NEXT_PUBLIC_API_URL=${API_PUBLIC_URL}" >> apps/admin/.env.local
  fi
fi

echo "==> [3/5] تثبيت حزم npm لكل الـworkspaces (api + admin + packages) ..."
npm install

echo "==> [4/5] استنى Postgres يخلص healthcheck ..."
for i in $(seq 1 30); do
  status=$(docker inspect --format='{{.State.Health.Status}}' baytak-db 2>/dev/null || echo "starting")
  [ "$status" = "healthy" ] && break
  sleep 2
done

echo "==> [5/5] تطبيق الـmigrations ..."
(cd apps/api && set -a && source .env && set +a && node ../../infra/migrations/migrate.js)

echo ""
echo "==================================================================="
echo "الأساسيات جاهزة (Postgres/Redis/MinIO + api + admin) — start.sh هيشغّلهم تلقائيًا."
echo "==================================================================="
echo ""

# تثبيت Flutter اختياري بالكامل من هنا لآخر السكريبت — فشله (مثلاً بطء/انقطاع الشبكة) ميأثرش
# على الخطوات فوق خالص، ومش لازم يوقف السكريبت (set +e مؤقتة هنا فقط لهذا الغرض).
set +e
FLUTTER_VERSION="3.44.9"
echo "==> تثبيت Flutter SDK (${FLUTTER_VERSION}, stable) — اختياري، لتطبيقات العميل/الفني بس ..."
if [ ! -d /opt/flutter ]; then
  if curl -fsSL --retry 3 --retry-delay 3 -o /tmp/flutter.tar.xz \
      "https://storage.googleapis.com/flutter_infra_release/releases/stable/linux/flutter_linux_${FLUTTER_VERSION}-stable.tar.xz"; then
    sudo mkdir -p /opt
    if sudo tar xf /tmp/flutter.tar.xz -C /opt && sudo chown -R "$(whoami)" /opt/flutter; then
      export PATH="$PATH:/opt/flutter/bin"
      grep -qxF 'export PATH="$PATH:/opt/flutter/bin"' ~/.bashrc || echo 'export PATH="$PATH:/opt/flutter/bin"' >> ~/.bashrc
      git config --global --add safe.directory /opt/flutter
      flutter config --enable-web --no-analytics >/dev/null 2>&1
      flutter precache --web >/dev/null 2>&1
      echo "==> Flutter اتثبّت بنجاح."
    else
      echo "==> تحذير: فشل استخراج/تجهيز Flutter — apps/api و apps/admin مش متأثرين خالص."
      echo "    جرّب يدويًا من التيرمنال: curl -fsSL -o /tmp/flutter.tar.xz '...' ثم استخرجه بنفسك،"
      echo "    أو ابعت 'Show Log' من إشعار الـDart extension عشان تعرف السبب بالظبط."
    fi
  else
    echo "==> تحذير: فشل تحميل Flutter (على الأغلب مشكلة شبكة مؤقتة) — apps/api و apps/admin مش متأثرين خالص."
    echo "    عيد المحاولة يدويًا من التيرمنال: bash .devcontainer/setup.sh"
  fi
  rm -f /tmp/flutter.tar.xz
else
  echo "==> Flutter موجود بالفعل في /opt/flutter."
fi
set -e

echo ""
echo "==================================================================="
echo "لتطبيقات Flutter (اختياري، شغّلهم يدويًا وقت ما تحتاجهم):"
echo "  cd apps/customer-app && flutter pub get && flutter run -d web-server --web-port=8090 --web-hostname=0.0.0.0"
echo "  cd apps/technician-app && flutter pub get && flutter run -d web-server --web-port=8091 --web-hostname=0.0.0.0"
echo "==================================================================="
