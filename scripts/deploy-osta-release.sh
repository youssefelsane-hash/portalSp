#!/usr/bin/env bash
# بناء جانبي قبل إيقاف الخدمات؛ لا نبني فوق .next التي تخدم العملاء حالياً.
set -euo pipefail
umask 077

ROOT=/srv/osta/app
OWNER=osta
TARGET="${1:-}"
API_URL=https://api.ostahome.com/api/v1
[[ "$EUID" == 0 ]] || { echo 'Run with sudo bash.' >&2; exit 1; }
[[ "$TARGET" =~ ^[a-f0-9]{40}$ ]] || { echo 'Pass the full tested commit SHA.' >&2; exit 1; }
for tool in git node npm runuser systemctl curl tar pg_dump pg_restore sha256sum flock install; do
  command -v "$tool" >/dev/null || { echo "Missing: $tool" >&2; exit 1; }
done
node -e 'const [n,m]=process.versions.node.split(".").map(Number);if(n<20||n>=25||(n===20&&m<9))process.exit(1)' || {
  echo 'Use Node.js 22 LTS (supported range: 20.9 to 24).' >&2; exit 1;
}
exec 9>/run/lock/osta-release.lock
flock -n 9 || { echo 'Another deployment is running.' >&2; exit 1; }
as_owner() { runuser -u "$OWNER" -- "$@"; }
git_owner() { as_owner git -C "$ROOT" "$@"; }
git_owner diff --quiet
git_owner diff --cached --quiet
git_owner fetch origin
git_owner merge-base --is-ancestor "$TARGET" origin/main
git_owner merge-base --is-ancestor HEAD "$TARGET"
BEFORE="$(git_owner rev-parse HEAD)"

pick_service() {
  local unit working_dir
  for unit in "$@"; do
    if [[ "$(systemctl show "$unit" -p LoadState --value)" == loaded ]]; then
      working_dir="$(systemctl show "$unit" -p WorkingDirectory --value)"
      case "$working_dir" in "$ROOT"|"$ROOT"/*) ;; *) continue ;; esac
      [[ "$(systemctl show "$unit" -p User --value)" == "$OWNER" ]] || continue
      printf '%s' "$unit"
      return
    fi
  done
  echo "Cannot identify service from: $*. Nothing stopped." >&2
  return 1
}
API_SERVICE="$(pick_service osta-api.service)"
ADMIN_SERVICE="$(pick_service osta-admin.service)"
WEB_SERVICE="$(pick_service osta-web.service osta-customer-web.service osta-customer.service)"
SERVICES=("$API_SERVICE" "$ADMIN_SERVICE" "$WEB_SERVICE")
for unit in "${SERVICES[@]}"; do systemctl is-active --quiet "$unit"; done
as_owner test -r /etc/osta/api.env
[[ "$(df -Pk /srv/osta | awk 'END {print $4}')" -ge 6291456 ]] || {
  echo 'At least 6 GiB free is required for staged builds and rollback files.' >&2; exit 1;
}

BACKUP="/srv/osta/backups/release-$(date -u +%Y%m%dT%H%M%SZ)-${TARGET:0:8}"
if [[ ! -d /srv/osta/backups ]]; then install -d -m 700 -o "$OWNER" -g "$OWNER" /srv/osta/backups; fi
as_owner test -x /srv/osta/backups || { echo 'osta cannot access /srv/osta/backups. Fix its ownership before deploying.' >&2; exit 1; }
STAGE="$(mktemp -d /srv/osta/release-stage.XXXXXX)"
mkdir -p "$BACKUP"
chown "$OWNER:$OWNER" "$STAGE" "$BACKUP"
STOPPED=false
SWITCHED=false
MOVED_OLD=()
INSTALLED_NEW=()

finish() {
  local code=$? path restored=true
  trap - EXIT
  if [[ "$code" != 0 && "$STOPPED" == true ]]; then
    systemctl stop "${SERVICES[@]}" || true
    for path in "${INSTALLED_NEW[@]}"; do
      mkdir -p "$STAGE/failed/$(dirname "$path")"
      mv "$ROOT/$path" "$STAGE/failed/$path" || restored=false
    done
    for path in "${MOVED_OLD[@]}"; do
      if [[ -e "$ROOT/$path" || -L "$ROOT/$path" ]]; then restored=false; continue; fi
      mv "$BACKUP/$path" "$ROOT/$path" || restored=false
    done
    systemctl start "${SERVICES[@]}" || restored=false
    if [[ "$restored" == true ]]; then
      echo "Deployment failed. Previous build/dependencies restored from $BEFORE." >&2
    else
      echo 'Deployment failed and automatic recovery was incomplete. Manual recovery is required.' >&2
    fi
    echo 'Database migrations are NOT rolled back; Git remains at the target commit.' >&2
    echo "Inspect systemctl/journalctl before retrying. Backup: $BACKUP" >&2
  fi
  if [[ "$code" == 0 || "$SWITCHED" == false ]]; then rm -rf -- "$STAGE"; fi
  exit "$code"
}
trap finish EXIT
git_owner archive "$TARGET" | as_owner tar -x -C "$STAGE"
# هذه الملفات محلية وخاصة، فلا تدخل Git أو الأرشيف المسلّم للمستخدم.
shopt -s nullglob
for app in api admin customer-web; do
  for file in "$ROOT/apps/$app"/.env*; do
    [[ -f "$file" && "$file" != *.example ]] || continue
    as_owner cp -p "$file" "$STAGE/apps/$app/"
  done
done
for unit in "$ADMIN_SERVICE" "$WEB_SERVICE"; do
  # EnvironmentFile هو المصدر الفعلي لو القيم محفوظة خارج المشروع.
  if [[ "$unit" == "$ADMIN_SERVICE" ]]; then app=admin; else app=customer-web; fi
  env_files="$(systemctl show "$unit" -p EnvironmentFiles --value)"
  for file in $env_files; do
    [[ "$file" == /* && -f "$file" ]] || continue
    as_owner sh -c 'printf "\n" >> "$2"; cat "$1" >> "$2"' sh "$file" "$STAGE/apps/$app/.env.production.local"
  done
done
as_owner bash -s -- "$STAGE" "$API_URL" <<'BUILD'
set -euo pipefail
cd "$1"
export NEXT_PUBLIC_API_URL="$2"
export NEXT_PUBLIC_SITE_URL=https://www.ostahome.com
npm ci
npm run build --workspace=@baytak/shared-types
npm run build --workspace=@baytak/api
npm run build --workspace=@baytak/admin -- --webpack
npm run build --workspace=customer-web -- --webpack
test -s apps/api/dist/main.js
test -s apps/admin/.next/BUILD_ID
test -s apps/customer-web/.next/BUILD_ID
BUILD

as_owner bash -s -- "$STAGE" "$BACKUP" <<'DATABASE'
set -euo pipefail
set -a
source /etc/osta/api.env
set +a
cd "$1"
bash scripts/backup-db.sh "$2/database"
node scripts/check-migrations.js
node infra/migrations/migrate.js
DATABASE

[[ "$(git_owner rev-parse HEAD)" == "$BEFORE" ]] || { echo 'Server checkout changed during build; refusing activation.' >&2; exit 1; }
git_owner diff --quiet
git_owner diff --cached --quiet
git_owner merge --ff-only "$TARGET"
# توقّف قصير للتبديل فقط؛ كل بناء اكتمل والخدمات القديمة كانت تعمل أثناءه.
STOPPED=true
systemctl stop "${SERVICES[@]}"
SWITCHED=true
for path in node_modules apps/api/node_modules apps/admin/node_modules apps/customer-web/node_modules packages/shared-types/dist apps/api/dist apps/admin/.next apps/customer-web/.next; do
  if [[ -e "$ROOT/$path" || -L "$ROOT/$path" ]]; then
    mkdir -p "$BACKUP/$(dirname "$path")"
    mv "$ROOT/$path" "$BACKUP/$path"
    MOVED_OLD+=("$path")
  fi
  if [[ -e "$STAGE/$path" || -L "$STAGE/$path" ]]; then
    mv "$STAGE/$path" "$ROOT/$path"
    INSTALLED_NEW+=("$path")
  fi
done

wait_health() {
  local url="$1" api="${2:-false}" attempt response
  for attempt in {1..30}; do
    if response="$(curl --silent --show-error --fail --max-time 10 "$url" 2>/dev/null)"; then
      if [[ "$api" == false ]] || printf '%s' "$response" | node -e 'let s="";process.stdin.on("data",v=>s+=v);process.stdin.on("end",()=>{try{const b=JSON.parse(s);const d=b.data??b;process.exit(d.status==="ok"&&d.database==="up"?0:1)}catch{process.exit(1)}})'; then return; fi
    fi
    sleep 4
  done
  echo "Health check failed: $url" >&2
  return 1
}
systemctl start "$API_SERVICE"
wait_health "$API_URL/health" true
systemctl start "$ADMIN_SERVICE" "$WEB_SERVICE"
wait_health https://admin.ostahome.com/login
wait_health https://www.ostahome.com/
for unit in "${SERVICES[@]}"; do systemctl is-active --quiet "$unit"; done
STOPPED=false
printf 'Deployed %s\nPrevious build: %s\nBackup: %s\n' "$TARGET" "$BEFORE" "$BACKUP"
