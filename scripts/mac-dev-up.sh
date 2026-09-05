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
# **النسخة الأحدث مش دايمًا الأصلح.** الفحص القديم كان `>= 20` بس، فقَبِل Node 26 — والنتيجة
# كانت أسوأ من رفض صريح: أدوات البناء (Next 16 SWC/turbopack) مالهاش نسخة native للإصدار ده
# فبتفشل، والـAPI بيقلع ويطبع «started» بس مابيردش على أي طلب. كل حاجة «شغّالة» ومفيش حاجة
# بتشتغل. النطاق المدعوم متسجّل دلوقتي في `engines` في كل package.json.
NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]")
if [[ "$NODE_MAJOR" -lt 20 ]]; then
  die "Node $(node -v) قديم — المشروع محتاج 20.9 أو أحدث. سطّب النسخة المدعومة: brew install node@22"
elif [[ "$NODE_MAJOR" -ge 25 ]]; then
  echo "${RED}❌ Node $(node -v) أحدث من اللي أدوات المشروع بتدعمه (المدعوم: 20–24، وCI بيستخدم 22).${OFF}" >&2
  echo "${YELLOW}   الأعراض اللي بتيجي من ده بالظبط: Next.js مابيقلعش خالص، والـAPI بيطبع «started»${OFF}" >&2
  echo "${YELLOW}   وبعدين مابيردش على أي طلب — فالواجهات تبان فاضية والبيانات موجودة.${OFF}" >&2
  echo "" >&2
  echo "${BLUE}   الإصلاح:${OFF}" >&2
  echo "     brew install node@22" >&2
  echo "     echo 'export PATH=\"/opt/homebrew/opt/node@22/bin:\$PATH\"' >> ~/.zshrc" >&2
  echo "     source ~/.zshrc && node -v      # لازم تطلع v22.x" >&2
  exit 1
fi
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

# ── 6) بيانات التشغيل — ده سبب «الكروت الرمادية» الحقيقي ───────────────────────
# قاعدة نضيفة بعد الـmigrations فيها فئات وخدمات، بس **صفر مدن وصفر نطاقات خدمة وصفر حساب
# أدمن تقدر تدخل بيه** (الصف الوحيد في `users` هو حساب المنصّة النظامي و`is_active=false`).
# يعني كل حاجة «بتشتغل» ومفيش حاجة بتبان — وده بالظبط اللي بيتشاف كصفحات رمادية فاضية.
step "٦/٧ — بيفحص بيانات التشغيل"
cats=$(docker exec baytak-db psql -U baytak -d baytak -tAc "SELECT count(*) FROM service_categories WHERE deleted_at IS NULL AND is_active" 2>/dev/null || echo 0)
zones=$(docker exec baytak-db psql -U baytak -d baytak -tAc "SELECT count(*) FROM service_zones WHERE deleted_at IS NULL" 2>/dev/null || echo 0)

# **بنزرع بس لو القاعدة فاضية فعلاً.** لو عندك بياناتك (مناطق وأسعار وحسابات بنيتها بنفسك)،
# الزرع هيبقى تلويث لشغلك — والسكريبت ده مايلمسش حاجة موجودة.
if [[ "$zones" -eq 0 ]]; then
  warn "مفيش أي نطاق خدمة — القاعدة دي فاضية، بيزرع الحد الأدنى…"
  DATABASE_URL="$DB_URL" node scripts/seed-dev-data.js || die "زرع البيانات فشل."
else
  ok "بياناتك موجودة ($cats فئة · $zones نطاق) — مفيش زرع، ولا حاجة اتلمست"
fi

# **الفحص اللي بيمسك «اللوحة فاضية والبيانات موجودة»**: بعد تدقيق S-1 بقى كل مسار أدمن محتاج
# صلاحية صريحة. حساب دوره مش شايل الصلاحيات الجديدة بيدخل عادي، بس الـsidebar بيخفي كل بند
# مالوش صلاحيته وكروت اللوحة بترجع 403 — الشكل بالظبط زي «النظام مش شغال».
supers=$(docker exec baytak-db psql -U baytak -d baytak -tAc "SELECT count(*) FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE r.is_super_admin AND r.is_active AND r.deleted_at IS NULL" 2>/dev/null || echo 0)
if [[ "$supers" -eq 0 ]]; then
  warn "مفيش حساب أدمن بصلاحية كاملة — اللوحة هتبان شبه فاضية حتى لو البيانات موجودة."
  warn "شوف الحسابات:  node scripts/admin-access.js"
else
  ok "$supers حساب بصلاحية كاملة"
fi

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

# فحص حقيقي: هل الكتالوج بيرجع صفوف فعلاً؟ `/health` بيقول «السيرفر عايش»، مش «فيه بيانات».
api_cats=$(curl -fsS http://localhost:3000/api/v1/service-categories 2>/dev/null | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const j=JSON.parse(d);console.log((j.data??j).length)}catch{console.log(0)}})" 2>/dev/null || echo 0)
if [[ "$api_cats" -gt 0 ]]; then
  ok "الـAPI بيرجّع $api_cats فئة فعلاً — البيانات واصلة"
else
  warn "الـAPI رد على /health بس رجّع صفر فئات — شوف $LOGS/api.log"
fi

# **كل لوحة بتتفحص لوحدها، وفشلها بيتقال صراحةً.** الإصدار القديم كان بيستنى الاتنين مع بعض
# وبعدين يطبع «✅ لوحة الإدارة · موقع العميل» **مهما حصل** — فلوحة ماتت وقت الإقلاع كانت بتتقال
# كأنها نجحت، والمستخدم يروح يدوّر على المشكلة في مكان تاني خالص.
#
# **والـfallback**: Next 16 بيستخدم Turbopack افتراضيًا، وعلى ماك ARM بنسخة Node/بيئة معيّنة
# بيرفض يشتغل خالص (وSWC بيقع على WASM). `next dev --webpack` بيشتغل عادي. مابنفرضش webpack
# على الكل (Turbopack أسرع وشغّال على Linux/CI)، بس لو اللوحة ماقلعتش بنعيد تشغيلها بيه
# **ونقول إننا عملنا كده** — بدل ما المستخدم يكتشف لوحده.
start_panel() {
  local dir="$1" port="$2" log="$3" label="$4"

  ( cd "$dir" && npm run dev >"$log" 2>&1 & )
  if wait_for_port "$port" 90; then ok "$label جاهزة على :$port"; return 0; fi

  warn "$label ماقلعتش على :$port — بيجرّب webpack بدل Turbopack…"
  local pids; pids=$(lsof -ti ":$port" 2>/dev/null || true)
  [[ -n "$pids" ]] && kill -9 $pids 2>/dev/null || true
  ( cd "$dir" && npm run dev:webpack >"$log" 2>&1 & )
  if wait_for_port "$port" 90; then
    ok "$label جاهزة على :$port ${DIM}(webpack — Turbopack مش شغّال في البيئة دي)${OFF}"
    return 0
  fi

  echo "${RED}❌ $label مش قادرة تقلع على :$port بأي من الطريقتين.${OFF}" >&2
  echo "${DIM}$(tail -20 "$log")${OFF}" >&2
  return 1
}

wait_for_port() {
  local port="$1" tries="$2" i
  printf "   بيستنى :%s" "$port"
  for i in $(seq 1 "$tries"); do
    if curl -fsS -o /dev/null "http://localhost:$port" 2>/dev/null; then echo; return 0; fi
    printf "."; sleep 1
  done
  echo
  return 1
}

PANELS_OK=1
start_panel apps/admin        3001 "$LOGS/admin.log"        "لوحة الإدارة" || PANELS_OK=0
start_panel apps/customer-web 3002 "$LOGS/customer-web.log" "موقع العميل"  || PANELS_OK=0

LAN_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "<عنوان-الماك>")

# **الأرقام المعروضة لازم تكون أرقام القاعدة دي فعلاً، مش أرقام الزرع.** لو القاعدة فيها
# بياناتك أنت (وده الوضع الطبيعي بعد أول تشغيل)، طباعة أرقام الزرع الثابتة بتوديك تجرب تدخل
# بحساب مش موجود أصلاً وتفتكر إن الدخول مكسور.
db_q() { docker exec baytak-db psql -U baytak -d baytak -tAc "$1" 2>/dev/null | head -3 | tr '\n' ' ' | sed 's/ *$//'; }
ADMIN_PHONE=$(db_q "SELECT u.phone_number FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id WHERE r.is_super_admin AND u.deleted_at IS NULL AND u.is_active ORDER BY u.created_at")
TECH_PHONE=$(db_q "SELECT u.phone_number FROM users u JOIN technician_profiles t ON t.user_id=u.id WHERE u.deleted_at IS NULL AND u.is_active ORDER BY u.created_at")
CUST_PHONE=$(db_q "SELECT phone_number FROM users WHERE user_type='customer' AND deleted_at IS NULL AND is_active ORDER BY created_at")
: "${ADMIN_PHONE:=—}"; : "${TECH_PHONE:=—}"; : "${CUST_PHONE:=—}"

if [[ "$PANELS_OK" -eq 1 ]]; then
  HEADLINE="${GREEN}═══ كله شغّال ═══${OFF}"
else
  HEADLINE="${YELLOW}═══ الـAPI شغّال — وفيه لوحة ماقلعتش (شوف الرسالة فوق) ═══${OFF}"
fi

cat <<EOF

$HEADLINE

  لوحة الإدارة    http://localhost:3001
  موقع العميل     http://localhost:3002
  الـAPI          http://localhost:3000/api/v1/health

  اللوجات         tail -f $LOGS/api.log
  القفل           scripts/mac-dev-up.sh --stop

  حسابات الدخول   ${DIM}(من قاعدتك أنت — أول ٣ في كل نوع)${OFF}
    أدمن          $ADMIN_PHONE
    فني           $TECH_PHONE
    عميل          $CUST_PHONE
  كود الـOTP      ${DIM}tail -f $LOGS/api.log | grep OTP${OFF}

${DIM}── تطبيقات Flutter ──────────────────────────────────────────────
إيموليتور (الـAPI بيتشاف على 10.0.2.2 تلقائيًا — مفيش إعداد):
  cd apps/technician-app && flutter run --dart-define=ALLOW_EMULATOR=true
  cd apps/customer-app   && flutter run

موبايل حقيقي بالكابل (لازم تديله عنوان الماك على الشبكة):
  cd apps/technician-app && flutter run --dart-define=API_BASE_URL=http://$LAN_IP:3000/api/v1
  cd apps/customer-app   && flutter run --dart-define=API_BASE_URL=http://$LAN_IP:3000/api/v1
  (الموبايل والماك لازم يكونوا على نفس الواي-فاي)${OFF}
EOF
