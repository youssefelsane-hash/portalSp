#!/usr/bin/env bash
# **فحص شامل لبيئة التشغيل المحلية — أمر واحد، تقرير واحد.**
#
# الغرض إنه يجاوب على السؤال «ليه مفيش بيانات؟» بأدلة بدل تخمين. بيفحص كل حلقة في السلسلة
# بالترتيب — كونتينرات ⇒ قاعدة ⇒ API ⇒ لوحات ⇒ صلاحيات ⇒ شبكة — وبيوقف عند أول حلقة مكسورة
# ويقول **إيه بالظبط** اللي فيها.
#
#   scripts/dev-doctor.sh
#
# قراءة بحتة: مابيغيّرش أي حاجة، مابيشغّلش ولا بيقفل أي خدمة.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
DB="docker exec baytak-db psql -U baytak -d baytak -tAc"
API="http://localhost:3000/api/v1"

G=$'\033[32m'; R=$'\033[31m'; Y=$'\033[33m'; D=$'\033[2m'; B=$'\033[1m'; O=$'\033[0m'
pass() { echo "  ${G}✅${O} $*"; }
fail() { echo "  ${R}❌${O} $*"; }
warn() { echo "  ${Y}⚠️ ${O} $*"; }
info() { echo "  ${D}$*${O}"; }
head2() { echo; echo "${B}$*${O}"; }

echo
echo "${B}═══ فحص بيئة التطوير — $(date '+%H:%M:%S') ═══${O}"

# ── ١) الأساسيات ────────────────────────────────────────────────────────────────
head2 "١) الأساسيات"
info "الفرع: $(git rev-parse --abbrev-ref HEAD 2>/dev/null) · آخر كوميت: $(git log -1 --format=%h 2>/dev/null)"
# **نسخة Node مش سطر معلومات — دي أول حاجة تكسر كل حاجة.** أول تقرير حقيقي من التقرير ده
# طبع «Node: v26.8.1» كمعلومة محايدة جنب قاعدة سليمة تمامًا، والسبب الفعلي كان هو ده: Next 16
# مابيقلعش على 26 خالص (اللوحتين ماتوا)، والـAPI بيطبع «started» وبعدين مابيردش على أي طلب.
# النطاق المدعوم متسجّل في `engines` في كل package.json — الفحص ده بيقراه من هناك مش بيكرّره.
if ! command -v node >/dev/null 2>&1; then
  fail "Node مش متسطّب"
else
  NODE_MAJOR=$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0)
  if [[ "$NODE_MAJOR" -lt 20 ]]; then
    fail "Node $(node -v) قديم — المدعوم 20.9 فأحدث.  الإصلاح: brew install node@22"
  elif [[ "$NODE_MAJOR" -ge 25 ]]; then
    fail "Node $(node -v) أحدث من المدعوم (20–24) — ${B}ده بيوقّف اللوحتين ويخلي الـAPI يقلع بلا ما يرد${O}"
    info "الإصلاح:  brew install node@22 && echo 'export PATH=\"/opt/homebrew/opt/node@22/bin:\$PATH\"' >> ~/.zshrc && source ~/.zshrc"
    info "وبعدها امسح الاعتماديات المبنية على النسخة القديمة:  rm -rf node_modules apps/*/node_modules && npm install"
  else
    pass "Node $(node -v) مدعوم"
  fi
fi
# **مابنوقفش هنا حتى لو Docker واقع** — التقرير التشخيصي قيمته إنه يكمّل ويوري كل حلقة في
# السلسلة، مش يقف عند أول واحدة. ممكن يكون Postgres شغّال محليًا من غير Docker أصلاً.
DOCKER_OK=0
docker info >/dev/null 2>&1 && { pass "Docker شغّال"; DOCKER_OK=1; } || fail "Docker مش شغّال — افتح Docker Desktop"

if [[ "$DOCKER_OK" -eq 1 ]]; then
  for c in baytak-db baytak-redis; do
    status=$(docker inspect -f '{{.State.Status}}' "$c" 2>/dev/null || echo "مش موجود")
    [[ "$status" == "running" ]] && pass "$c شغّال" || fail "$c: $status"
  done
fi

# ── ٢) القاعدة ──────────────────────────────────────────────────────────────────
head2 "٢) القاعدة — إيه اللي جوّاها فعلاً"
if ! $DB "SELECT 1" >/dev/null 2>&1; then
  fail "مش قادر أوصل للقاعدة"
else
  mig=$($DB "SELECT count(*) FROM schema_migrations" 2>/dev/null)
  files=$(ls infra/migrations/*.sql 2>/dev/null | wc -l | tr -d ' ')
  [[ "$mig" == "$files" ]] && pass "migrations: $mig مطبّقة من $files" \
                           || fail "migrations: $mig مطبّقة بس فيه $files ملف — القاعدة ناقصة!"
  for pair in "users:مستخدمين" "service_categories:فئات" "services:خدمات" "service_zones:نطاقات" "orders:طلبات" "technician_profiles:فنيين"; do
    t="${pair%%:*}"; label="${pair##*:}"
    n=$($DB "SELECT count(*) FROM $t WHERE deleted_at IS NULL" 2>/dev/null || echo "؟")
    printf "  %s%-12s%s %s\n" "$D" "$label" "$O" "$n"
  done
fi

# ── تشخيص «العملية عايشة بس مش بترد» ────────────────────────────────────────────
#
# العَرَض ده ليه سببين حقيقيين مختلفين تمامًا، والاتنين اتشافوا على نفس الجهاز:
#
#   ١) نسخة Node غير مدعومة (٢٦) — الـAPI بيطبع «started» ومابيخدمش أي طلب. القسم ١ فوق
#      بيمسكها، وساعتها الفرق إن **مفيش أي اتصال** من التطبيق على القاعدة.
#   ٢) استنزاف pool القاعدة من الدورات المجدولة — العملية بتشتغل والاتصالات موجودة، بس كلها
#      مشغولة/مستنية. البصمة المميزة: عدد اتصالات التطبيق = سقف الـpool بالظبط.
#
# الدالة دي بتطبع الأدلة اللي بتفرّق بينهم بدل ما تسيب التخمين.
DIAGNOSED=0
diagnose_unresponsive_api() {
  [[ "$DIAGNOSED" -eq 1 ]] && return 0
  DIAGNOSED=1
  [[ -f .dev-logs/api.log ]] && { echo; info "آخر ١٥ سطر من لوج الـAPI:"; tail -15 .dev-logs/api.log | sed 's/^/     /'; }

  $DB "SELECT 1" >/dev/null 2>&1 || return 0
  echo
  info "اتصالات التطبيق على القاعدة (العملية عايشة — فين الاتصالات؟):"

  local conns states advisory idle_tx
  conns=$($DB "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND application_name <> 'psql' AND pid <> pg_backend_pid()" 2>/dev/null || echo "؟")
  advisory=$($DB "SELECT count(*) FROM pg_locks WHERE locktype = 'advisory'" 2>/dev/null || echo "؟")
  idle_tx=$($DB "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND state = 'idle in transaction'" 2>/dev/null || echo 0)

  printf "  %s%-28s%s %s\n" "$D" "إجمالي اتصالات التطبيق" "$O" "$conns"
  printf "  %s%-28s%s %s\n" "$D" "أقفال استشارية" "$O" "$advisory"
  printf "  %s%-28s%s %s\n" "$D" "idle in transaction" "$O" "$idle_tx"

  states=$($DB "SELECT state || ' × ' || count(*) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() GROUP BY state ORDER BY count(*) DESC" 2>/dev/null)
  [[ -n "$states" ]] && echo "$states" | sed "s/^/     /"

  if [[ "$conns" == "0" ]]; then
    fail "العملية عايشة بس **مفيش ولا اتصال** على القاعدة — الـAPI مش بيوصل لها أصلاً."
    info "شوف نسخة Node في القسم ١، وسطور الخطأ في اللوج فوق."
  elif [[ "$conns" =~ ^[0-9]+$ ]] && [[ "$conns" -ge 10 ]]; then
    fail "عدد الاتصالات ($conns) واصل لسقف الـpool — ${B}استنزاف pool${O}: كل الاتصالات مشغولة ومفيش واحد فاضي لأي طلب."
    info "أشهر سبب: كود ماسك اتصال وهو مستني اتصال تاني. آخر استعلام لكل اتصال:"
    $DB "SELECT '     ' || state || '  ' || left(regexp_replace(query, '\s+', ' ', 'g'), 70) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() LIMIT 10" 2>/dev/null
  fi

  if [[ "$advisory" =~ ^[0-9]+$ ]] && [[ "$advisory" -gt 0 ]]; then
    warn "فيه $advisory قفل استشاري مأخوذ — الدورات المجدولة مالهاش أقفال استشارية بعد إصلاح 0272؛"
    warn "لو الرقم ده كبير ومستمر، فيه كود رجع للنمط القديم (قفل على مستوى الجلسة بيحجز اتصال)."
  fi

  if $DB "SELECT to_regclass('sweep_leases')" 2>/dev/null | grep -q sweep_leases; then
    echo
    info "إيجارات الدورات المجدولة (آخر تشغيل لكل دورة):"
    $DB "SELECT '     ' || rpad(lock_name, 34) || to_char(coalesce(last_released_at, renewed_at), 'HH24:MI:SS') || '  × ' || run_count FROM sweep_leases ORDER BY renewed_at DESC LIMIT 8" 2>/dev/null
  else
    warn "جدول sweep_leases مش موجود — الـmigrations ناقصة (0272)."
  fi
}

# ── ٣) الـAPI ───────────────────────────────────────────────────────────────────
head2 "٣) الـAPI (:3000)"
port3000=$(lsof -ti :3000 2>/dev/null | head -1)
[[ -n "$port3000" ]] && info "العملية: PID $port3000" || fail "مفيش أي حاجة شغّالة على :3000"

health=$(curl -fsS --max-time 5 "$API/health" 2>/dev/null || echo "")
if [[ -n "$health" ]]; then
  # الرد بيرجّع أرقام الـpool جوّاه — بنطبعها لأنها اللي بتفرّق بين «الـAPI بخير» و«لسه بيرد
  # بس فيه طلبات مستنية اتصال» (اللي هي بداية الاستنزاف قبل ما يتحول لتعليق كامل).
  printf '%s' "$health" | node -e "
let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{
  try{
    const b=JSON.parse(d); const h=b.data??b; const p=h.pool;
    console.log('  \x1b[32m✅\x1b[0m health: '+h.status+' · database: '+h.database);
    if(p) console.log('  \x1b[2m   pool: '+p.total+'/'+p.max+' مفتوح · '+p.idle+' خامل · '+p.waiting+' مستني\x1b[0m');
    if(p && p.waiting>0) console.log('  \x1b[31m❌\x1b[0m '+p.waiting+' طلب مستني اتصال — الـpool تحت ضغط، ده بداية الاستنزاف');
  }catch{ console.log('  \x1b[32m✅\x1b[0m health: '+d); }
})"
else
  fail "مش بيرد على $API/health"
  diagnose_unresponsive_api
fi

cats_json=$(curl -fsS --max-time 5 "$API/service-categories" 2>/dev/null || echo "")
if [[ -n "$cats_json" ]]; then
  n=$(printf '%s' "$cats_json" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{const j=JSON.parse(d);console.log((j.data??j).length)}catch{console.log('؟')}})")
  [[ "$n" != "0" && "$n" != "؟" ]] && pass "الكتالوج بيرجّع $n فئة — البيانات واصلة للتطبيقات" \
                                   || fail "الكتالوج رجّع صفر — التطبيقات هتبان فاضية"
else
  fail "مسار الكتالوج مش بيرد خالص"
fi

# طلب OTP حقيقي — ده اللي التطبيقات بتعلّق عليه
# `|| echo` هنا كان بيضيف "000" تانية جنب اللي curl بيطبعها ⇒ "000000". curl بيطبع الكود
# دايمًا مع `-w`، فالبديل الوحيد المطلوب هو لو الخرج طلع فاضي أصلاً.
otp_code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 -X POST "$API/auth/otp/request" \
  -H 'Content-Type: application/json' -d '{"phone_number":"+201000000003","purpose":"login"}' 2>/dev/null)
otp_code=${otp_code:-000}
case "$otp_code" in
  200|201) pass "طلب OTP رجّع $otp_code — مسار الدخول شغّال" ;;
  000)     fail "طلب OTP معلّق أو مفيش رد (timeout) — ده سبب اللودينج اللانهائي في التطبيق"
           # ممكن `/health` يعدّي والطلبات الحقيقية تتعلّق: `/health` استعلام واحد قصير، وطلب
           # الـOTP بيعمل شغل أكتر — فهو أول اللي بيحس بضغط الـpool.
           diagnose_unresponsive_api ;;
  *)       fail "طلب OTP رجّع $otp_code" ;;
esac

# ── ٤) اللوحات ──────────────────────────────────────────────────────────────────
head2 "٤) اللوحات"
for pair in "3001:لوحة الإدارة" "3002:موقع العميل"; do
  p="${pair%%:*}"; label="${pair##*:}"
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 8 "http://localhost:$p" 2>/dev/null); code=${code:-000}
  if [[ "$code" == "200" ]]; then pass "$label (:$p) بترد 200"
  elif [[ "$code" == "000" ]]; then
    fail "$label (:$p) مش بترد خالص"
    log=".dev-logs/$( [[ $p == 3001 ]] && echo admin || echo customer-web ).log"
    [[ -f "$log" ]] && { info "آخر ١٠ سطر:"; tail -10 "$log" | sed 's/^/     /'; }
  else fail "$label (:$p) رجّعت $code"; fi
done

# ── ٥) الصلاحيات ────────────────────────────────────────────────────────────────
head2 "٥) صلاحيات الأدمن"
if $DB "SELECT 1" >/dev/null 2>&1; then
  supers=$($DB "SELECT count(*) FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE r.is_super_admin AND r.is_active AND r.deleted_at IS NULL" 2>/dev/null || echo 0)
  if [[ "$supers" -gt 0 ]]; then
    pass "$supers حساب بصلاحية كاملة"
    $DB "SELECT '     ' || u.phone_number || '  ' || u.full_name FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id WHERE r.is_super_admin AND u.deleted_at IS NULL" 2>/dev/null
  else
    fail "مفيش حساب بصلاحية كاملة — السايدبار هيبان شبه فاضي حتى والبيانات موجودة"
    info "الإصلاح:  node scripts/admin-access.js"
  fi
fi

# ── ٦) الشبكة — للموبايل الحقيقي ────────────────────────────────────────────────
head2 "٦) الشبكة (للموبايل بالكابل)"
LAN=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "")
if [[ -n "$LAN" ]]; then
  info "عنوان الماك: $LAN"
  reach=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 "http://$LAN:3000/api/v1/health" 2>/dev/null); reach=${reach:-000}
  if [[ "$reach" == "200" ]]; then
    pass "الـAPI مسموع على الشبكة — الموبايل هيوصله"
    echo
    echo "  ${B}أوامر الموبايل الحقيقي:${O}"
    echo "  ${D}cd apps/technician-app && flutter run --dart-define=API_BASE_URL=http://$LAN:3000/api/v1${O}"
    echo "  ${D}cd apps/customer-app   && flutter run --dart-define=API_BASE_URL=http://$LAN:3000/api/v1${O}"
  else
    fail "الـAPI مش مسموع على $LAN (رجّع $reach) — الموبايل مش هيوصله حتى بالعنوان الصح"
    info "غالبًا جدار الحماية في macOS: الإعدادات ← الشبكة ← جدار الحماية"
  fi
else
  warn "مش لاقي عنوان الماك على الشبكة (مفيش واي-فاي؟)"
fi

# الجهاز الموصول
if command -v adb >/dev/null 2>&1; then
  devs=$(adb devices 2>/dev/null | grep -c "device$" || echo 0)
  [[ "$devs" -gt 0 ]] && pass "$devs جهاز أندرويد موصول" || warn "مفيش جهاز أندرويد موصول (adb مش شايف حاجة)"
fi

echo
echo "${D}ابعت التقرير ده كله زي ما هو.${O}"
echo
