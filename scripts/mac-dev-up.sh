#!/usr/bin/env bash
# تشغيل المنصّة كاملة محليًا على macOS — من الصفر، بأمر واحد.
#
# **ليه موجود**: التشغيل المحلي محتاج ٦ حاجات تشتغل بترتيب صح (Postgres، Redis، ملف بيئة،
# اعتماديات، migrations، تلات خدمات على تلات بورتات). أي واحدة ناقصة والنتيجة **مش رسالة خطأ
# واضحة** — الواجهات بتفتح عادي وتفضل كروت رمادية بتحمّل للأبد، وده أصعب في التشخيص من انهيار
# صريح. السكريبت ده بيعمل كل خطوة **وبيتحقق منها فعلاً** قبل ما يكمّل.
#
#   scripts/mac-dev-up.sh            # شغّل كل حاجة
#   scripts/mac-dev-up.sh --stop     # قفل كل حاجة
#   scripts/mac-dev-up.sh --reset-db # امسح القاعدة وابنيها من الأول (بيمسح كل بياناتك المحلية)
#
# كل خطوة idempotent — تشغيله تاني مايضرش.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE="$ROOT/infra/docker/docker-compose.yml"
LOGS="$ROOT/.dev-logs"
DB_URL="postgres://baytak:baytak@localhost:5432/baytak"

RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; BLUE=$'\033[34m'; DIM=$'\033[2m'; OFF=$'\033[0m'
ok()   { echo "${GREEN}✅${OFF} $*"; }
warn() { echo "${YELLOW}⚠️ ${OFF} $*"; }
die()  { echo "${RED}❌ $*${OFF}" >&2; exit 1; }
step() { echo; echo "${BLUE}▶ $*${OFF}"; }

# ── قفل كل حاجة ─────────────────────────────────────────────────────────────────
if [[ "${1:-}" == "--stop" ]]; then
  step "بيقفل الخدمات"
  for port in 3000 3001 3002; do
    pids=$(lsof -ti :$port 2>/dev/null || true)
    [[ -n "$pids" ]] && { kill -9 $pids 2>/dev/null || true; ok "البورت $port اتقفل"; }
  done
  docker compose -f "$COMPOSE" stop >/dev/null 2>&1 && ok "Postgres/Redis/MinIO اتقفلوا"
  echo; ok "كله اتقفل."
  exit 0
fi

cd "$ROOT"
mkdir -p "$LOGS"

# ── 1) المتطلبات ────────────────────────────────────────────────────────────────
step "١/٧ — بيتأكد من المتطلبات"
command -v docker >/dev/null 2>&1 || die "Docker مش متسطّب. سطّب Docker Desktop من docker.com وافتحه."
docker info >/dev/null 2>&1 || die "Docker متسطّب بس **مش شغّال**. افتح تطبيق Docker Desktop واستنى لحد ما الأيقونة تبقى خضرا، وبعدين شغّل السكريبت تاني."
command -v node >/dev/null 2>&1 || die "Node مش متسطّب. سطّبه: brew install node"
NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
[[ "$NODE_MAJOR" -ge 20 ]] || die "Node $NODE_MAJOR قديم — المشروع محتاج 20 أو أحدث (CI بيستخدم 22). حدّثه: brew upgrade node"
ok "Docker شغّال · Node $(node -v)"

# ── 2) قاعدة البيانات والكاش ────────────────────────────────────────────────────
step "٢/٧ — بيشغّل Postgres و Redis و MinIO"
if [[ "${1:-}" == "--reset-db" ]]; then
  warn "بيمسح القاعدة المحلية بالكامل (طلبت --reset-db)…"
  docker compose -f "$COMPOSE" down -v >/dev/null 2>&1 || true
fi
docker compose -f "$COMPOSE" up -d db redis minio >/dev/null 2>&1 \
  || die "فشل تشغيل الكونتينرات. جرّب: docker compose -f $COMPOSE up -d"

printf "   بيستنى القاعدة تجهز"
for i in $(seq 1 45); do
  if docker exec baytak-db pg_isready -U baytak >/dev/null 2>&1; then echo; break; fi
  printf "."; sleep 1
  [[ $i -eq 45 ]] && { echo; die "Postgres مقلعش خلال ٤٥ ثانية. شوف اللوج: docker logs baytak-db"; }
done
redis_ok=$(docker exec baytak-redis redis-cli ping 2>/dev/null || echo "")
[[ "$redis_ok" == "PONG" ]] || die "Redis مش بيرد. شوف: docker logs baytak-redis"
ok "Postgres جاهز · Redis بيرد"

# ── 3) ملف البيئة ───────────────────────────────────────────────────────────────
step "٣/٧ — بيجهّز ملف البيئة"
if [[ ! -f apps/api/.env ]]; then
  cp apps/api/.env.example apps/api/.env
  # أسرار عشوائية حقيقية بدل قيم `change-me` — مش شرط محليًا، بس بيمنع إنك تشحن قيمة افتراضية
  # بالغلط لو نسخت الملف ده لبيئة تانية.
  for key in JWT_ACCESS_SECRET JWT_REFRESH_SECRET SETTINGS_ENCRYPTION_KEY PII_ENCRYPTION_KEY; do
    secret=$(openssl rand -hex 24)
    /usr/bin/sed -i '' "s|^${key}=.*|${key}=${secret}|" apps/api/.env
  done
  ok "apps/api/.env اتعمل بأسرار عشوائية"
else
  ok "apps/api/.env موجود بالفعل"
fi
[[ -f apps/admin/.env.local ]] || echo "NEXT_PUBLIC_API_URL=http://localhost:3000/api/v1" > apps/admin/.env.local
[[ -f apps/customer-web/.env.local ]] || echo "NEXT_PUBLIC_API_URL=http://localhost:3000/api/v1" > apps/customer-web/.env.local

# ── 4) الاعتماديات ──────────────────────────────────────────────────────────────
step "٤/٧ — بيسطّب الاعتماديات (ممكن تاخد دقيقة أول مرة)"
npm install --silent >>"$LOGS/npm-install.log" 2>&1 || die "npm install فشل. اللوج: $LOGS/npm-install.log"
npm --prefix packages/shared-types run build --silent >>"$LOGS/npm-install.log" 2>&1 \
  || die "بناء shared-types فشل. اللوج: $LOGS/npm-install.log"
ok "الاعتماديات + shared-types جاهزين"

# ── 5) الـmigrations ────────────────────────────────────────────────────────────
step "٥/٧ — بيطبّق الـmigrations"
node scripts/check-migrations.js || die "فيه رقم migration مكرر — اتصلح الأول."
DATABASE_URL="$DB_URL" node infra/migrations/migrate.js >>"$LOGS/migrate.log" 2>&1 \
  || die "الـmigrations فشلت. اللوج: $LOGS/migrate.log"
applied=$(docker exec baytak-db psql -U baytak -d baytak -tAc "SELECT count(*) FROM schema_migrations" 2>/dev/null || echo 0)
ok "$applied migration متطبّقة"

# ── 6) فحص البيانات — ده سبب «الكروت الرمادية» الأشهر ──────────────────────────
step "٦/٧ — بيتأكد إن فيه بيانات فعلاً"
cats=$(docker exec baytak-db psql -U baytak -d baytak -tAc "SELECT count(*) FROM service_categories WHERE deleted_at IS NULL AND is_active" 2>/dev/null || echo 0)
svcs=$(docker exec baytak-db psql -U baytak -d baytak -tAc "SELECT count(*) FROM services WHERE deleted_at IS NULL AND is_active" 2>/dev/null || echo 0)
if [[ "$cats" -eq 0 ]]; then
  warn "القاعدة فيها **صفر فئات خدمة** — عشان كده شاشة العميل بتفضل كروت رمادية فاضية."
  warn "افتح لوحة الأدمن → الكتالوج وضيف فئة وخدمة، أو استورد بياناتك."
else
  ok "$cats فئة · $svcs خدمة"
fi
admins=$(docker exec baytak-db psql -U baytak -d baytak -tAc "SELECT count(*) FROM users WHERE user_type='admin' AND deleted_at IS NULL" 2>/dev/null || echo 0)
[[ "$admins" -eq 0 ]] && warn "مفيش أي مستخدم أدمن — مش هتقدر تدخل لوحة الإدارة." || ok "$admins مستخدم أدمن"

# ── 7) الخدمات ──────────────────────────────────────────────────────────────────
step "٧/٧ — بيشغّل الـAPI واللوحات"
# البورت المشغول بعملية قديمة هو أكتر سبب للحيرة: الواجهة بتكلّم **نسخة قديمة** من الـAPI
# (أو مفيش نسخة أصلاً) وأنت شايف الكود الجديد قدامك. بنقفل أي عملية قديمة قبل ما نشغّل.
for port in 3000 3001 3002; do
  pids=$(lsof -ti :$port 2>/dev/null || true)
  [[ -n "$pids" ]] && { kill -9 $pids 2>/dev/null || true; warn "قفلت عملية قديمة على البورت $port"; }
done

( cd apps/api && npm run start:dev >"$LOGS/api.log" 2>&1 & )
printf "   بيستنى الـAPI"
for i in $(seq 1 90); do
  if curl -fsS http://localhost:3000/api/v1/health >/dev/null 2>&1; then echo; break; fi
  printf "."; sleep 1
  [[ $i -eq 90 ]] && { echo; echo "${DIM}$(tail -30 "$LOGS/api.log")${OFF}"; die "الـAPI مقلعش. اللوج كامل: $LOGS/api.log"; }
done
ok "API شغّال على :3000"

( cd apps/admin && npm run dev >"$LOGS/admin.log" 2>&1 & )
( cd apps/customer-web && npm run dev >"$LOGS/customer-web.log" 2>&1 & )
printf "   بيستنى اللوحات"
for i in $(seq 1 90); do
  if curl -fsS -o /dev/null http://localhost:3001 2>/dev/null && curl -fsS -o /dev/null http://localhost:3002 2>/dev/null; then echo; break; fi
  printf "."; sleep 1
  [[ $i -eq 90 ]] && { echo; warn "اللوحات لسه بتقلع — شوف $LOGS/admin.log و $LOGS/customer-web.log"; }
done
ok "لوحة الإدارة :3001 · موقع العميل :3002"

cat <<EOF

${GREEN}═══ كله شغّال ═══${OFF}

  لوحة الإدارة    http://localhost:3001
  موقع العميل     http://localhost:3002
  الـAPI          http://localhost:3000/api/v1/health

  اللوجات         tail -f $LOGS/api.log
  القفل           scripts/mac-dev-up.sh --stop

${DIM}تطبيقات Flutter (إيموليتور أندرويد — الـAPI بيتشاف على 10.0.2.2 تلقائيًا):
  cd apps/technician-app && flutter run --dart-define=ALLOW_EMULATOR=true
  cd apps/customer-app    && flutter run${OFF}
EOF
