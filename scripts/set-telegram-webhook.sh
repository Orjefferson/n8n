#!/usr/bin/env bash
# Aponta o webhook do Bot Telegram para o path do Telegram Trigger no n8n.
# Uso:
#   ./scripts/set-telegram-webhook.sh
#   WEBHOOK_PATH=telegram-approver ./scripts/set-telegram-webhook.sh
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

: "${TELEGRAM_BOT_TOKEN:?Defina TELEGRAM_BOT_TOKEN no .env}"
: "${WEBHOOK_URL:?Defina WEBHOOK_URL no .env (URL pública HTTPS do túnel)}"

# Path padrão do Telegram Trigger no workflow 02 (campo webhookId / path)
WEBHOOK_PATH="${WEBHOOK_PATH:-telegram-approver}"
BASE="${WEBHOOK_URL%/}"
TARGET="${BASE}/webhook/${WEBHOOK_PATH}"

echo "Definindo webhook → ${TARGET}"
curl -sS -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -H 'Content-Type: application/json' \
  -d "{\"url\":\"${TARGET}\"}" | tee /dev/stderr
echo
curl -sS "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo"
echo
