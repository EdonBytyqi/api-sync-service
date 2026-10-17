#!/usr/bin/env bash
# Smoke test of the running compose stack through the dashboard's nginx
# (spec 005, AK-4.2 job 6). Expects mock rates 0 and the schedule off:
#   FAILURE_RATE=0 SLOW_RATE=0 RATE_LIMIT_RATE=0 SYNC_SCHEDULE_ENABLED=false docker compose up -d --build --wait
set -euo pipefail

BASE="${BASE_URL:-http://localhost:${DASHBOARD_PORT:-8080}}"
TIMEOUT_S="${SMOKE_TIMEOUT_S:-120}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

json() { node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const v=JSON.parse(d);console.log($1)})"; }
fail() { echo "SMOKE FAIL: $*" >&2; exit 1; }

echo "1. Dashboard is served"
curl -fsS "$BASE/" | grep -q '<title>ERP-Synchronisation</title>' || fail "index.html without title"
curl -fsS "$BASE/some/client/route" | grep -q '<app-root>' || fail "unknown path does not serve the app"

echo "2. Service health through the proxy"
health="$(curl -fsS "$BASE/api/health")"
[ "$(echo "$health" | json 'v.database')" = "up" ] || fail "health: $health"

echo "3. POST /api/sync → 202 with Location"
code="$(curl -sS -o "$tmp/body" -D "$tmp/headers" -w '%{http_code}' -X POST "$BASE/api/sync")"
[ "$code" = "202" ] || fail "POST /api/sync returned $code: $(cat "$tmp/body")"
id="$(json 'v.id' < "$tmp/body")"
grep -qi "^location: /api/sync/runs/$id" "$tmp/headers" || fail "Location header: $(grep -i '^location' "$tmp/headers" || true)"
echo "   run #$id started"

echo "4. Wait for the run to finish (max ${TIMEOUT_S}s)"
deadline=$((SECONDS + TIMEOUT_S))
while :; do
  curl -fsS "$BASE/api/sync/runs/$id" > "$tmp/run"
  status="$(json 'v.status' < "$tmp/run")"
  [ "$status" != "running" ] && break
  [ "$SECONDS" -ge "$deadline" ] && fail "run #$id still running after ${TIMEOUT_S}s"
  sleep 1
done

summary="$(json '`${v.status} pages=${v.pagesOk}/${v.pagesTotal} products=${v.productsInserted + v.productsUpdated + v.productsUnchanged}`' < "$tmp/run")"
echo "   $summary"
[ "$summary" = "completed pages=100/100 products=10000" ] || fail "unexpected result: $(cat "$tmp/run")"

echo "SMOKE OK"
