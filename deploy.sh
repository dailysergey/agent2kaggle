#!/usr/bin/env bash
# Развернуть публичный A2A-край на Netlify.
# Требует NETLIFY_AUTH_TOKEN в окружении (см. README: личный токен доступа).
set -euo pipefail
cd "$(dirname "$0")"

: "${NETLIFY_AUTH_TOKEN:?нет NETLIFY_AUTH_TOKEN — создай личный токен в Netlify и экспортируй}"
SITE="${1:-aq-kaggle}"
NTL="npx --yes netlify-cli@latest"

echo "== 1. кто мы =="
$NTL status || true

echo "== 2. сайт $SITE =="
$NTL sites:create --name "$SITE" --manual 2>/dev/null || echo "   (уже существует — продолжаю)"
$NTL link --name "$SITE"

echo "== 3. переменные окружения =="
# Значения берутся из .env и .secrets и НЕ печатаются.
set -a; . ./.env; set +a
$NTL env:set A2A_TOKEN "$A2A_TOKEN" --context production >/dev/null
$NTL env:set KAGGLE_ACCESS_TOKEN "$(cat .secrets/kaggle_access_token)" --context production >/dev/null
$NTL env:set DEFAULT_COMPETITION "$DEFAULT_COMPETITION" --context production >/dev/null
echo "   заданы: A2A_TOKEN, KAGGLE_ACCESS_TOKEN, DEFAULT_COMPETITION"

echo "== 4. выкладка =="
$NTL deploy --prod --dir public --functions netlify/functions

echo
echo "== 5. проверка =="
URL=$($NTL api getSite --data "{\"site_id\":\"$($NTL status --json | node -pe 'JSON.parse(require("fs").readFileSync(0)).siteData.id')\"}" \
      2>/dev/null | node -pe 'try{JSON.parse(require("fs").readFileSync(0)).ssl_url}catch(e){""}' || true)
[ -z "$URL" ] && URL="https://$SITE.netlify.app"
echo "адрес: $URL"
echo "-- карточка:"; curl -fsS "$URL/.well-known/agent-card.json" | head -c 300; echo
echo "-- без токена (ожидается отказ):"
curl -s -o /dev/null -w '   HTTP %{http_code}\n' -X POST "$URL/a2a" \
  -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"message/send","params":{}}'
echo "-- с токеном:"
curl -fsS -X POST "$URL/a2a" -H "Authorization: Bearer $A2A_TOKEN" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"message/send","params":{"message":{"role":"user","kind":"message","messageId":"1","parts":[{"kind":"text","text":"'"$DEFAULT_COMPETITION"'"}]}}}' \
  | head -c 400; echo
