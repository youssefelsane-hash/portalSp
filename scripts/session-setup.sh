#!/usr/bin/env bash
# تجهيز بيئة التطوير — بيتشغّل تلقائيًا أول أي سيشن (SessionStart hook، docs/08 §133).
#
# **ليه موجود**: الكونتينر بيتولد فاضي كل مرة. من غير الملف ده كل سيشن بتضيّع وقت في:
# Postgres/Redis مش شغالين، `flutter build linux` بيفشل على gtk، شاشة وهمية مش موجودة،
# و`shared-types/dist` مش مبنية (فـtypecheck الأدمن بيكسر بأخطاء مضللة).
# كل خطوة idempotent — تشغيله تاني مايضرش.
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
say() { echo "  $*"; }

# ── 1) قواعد البيانات ────────────────────────────────────────────────────────────
if ! pg_isready -q 2>/dev/null; then
  pg_ctlcluster 16 main start 2>/dev/null || service postgresql start 2>/dev/null || true
  for _ in $(seq 1 10); do pg_isready -q 2>/dev/null && break; sleep 1; done
fi
pg_isready -q 2>/dev/null && say "✅ Postgres" || say "⚠️  Postgres مش شغال"

redis-cli ping >/dev/null 2>&1 || redis-server --daemonize yes >/dev/null 2>&1
redis-cli ping >/dev/null 2>&1 && say "✅ Redis" || say "⚠️  Redis مش شغال"

# ── 2) اعتماديات بناء Flutter Linux + التحقق البصري ──────────────────────────────
# من غيرها `flutter build linux` بيفشل، ومعاها بس نقدر نمسك بلاغات المالك البصرية
# (overflow / شاشة بيضا / زرار متغطّي) — `flutter test` بيختبر المنطق مش الرندر.
MISSING=()
for pkg in libgtk-3-dev libsecret-1-dev libjsoncpp-dev; do
  dpkg -s "$pkg" >/dev/null 2>&1 || MISSING+=("$pkg")
done
for bin in Xvfb fluxbox xdotool import; do
  command -v "$bin" >/dev/null 2>&1 || MISSING+=("$bin")
done
if [[ ${#MISSING[@]} -gt 0 ]]; then
  say "⏳ بيسطّب اعتماديات التحقق البصري الناقصة…"
  apt-get update -qq >/dev/null 2>&1
  apt-get install -y -qq libgtk-3-dev libsecret-1-dev libjsoncpp-dev pkg-config ninja-build \
                         xvfb fluxbox xdotool imagemagick x11-utils >/dev/null 2>&1
fi
command -v xdotool >/dev/null 2>&1 && pkg-config --exists gtk+-3.0 2>/dev/null \
  && say "✅ بناء Flutter + التحقق البصري جاهزين" || say "⚠️  اعتماديات Flutter لسه ناقصة"

# ── 3) shared-types ──────────────────────────────────────────────────────────────
# `main` بيشاور على `dist/` وهي مستبعدة من Git — من غير بناء، typecheck الأدمن بيكسر
# بأخطاء مضللة عن حقول «مش موجودة» وهي موجودة (بَقّة حقيقية اتكررت أكتر من مرة).
if [[ ! -d "$ROOT/packages/shared-types/dist" ]]; then
  ( cd "$ROOT/packages/shared-types" && npm run build >/dev/null 2>&1 ) \
    && say "✅ shared-types اتبنت" || say "⚠️  فشل بناء shared-types"
else
  say "✅ shared-types"
fi

# ── 4) migrations ────────────────────────────────────────────────────────────────
if pg_isready -q 2>/dev/null; then
  node "$ROOT/scripts/check-migrations.js" 2>&1 | sed 's/^/  /'
fi
