#!/usr/bin/env sh
set -eu

# Aggiornamento sicuro per Raspberry: evita --no-cache di default e pulisce solo cache/immagini Docker inutilizzate.
# Non usa mai docker prune --volumes, quindi non tocca data/, uploads/ o volumi persistenti.

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_DIR=$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)
SERVICE="${CLEARWAVE_UPDATE_SERVICE:-clearwave}"
MIN_FREE_MB="${CLEARWAVE_MIN_FREE_MB:-2500}"
NO_CACHE="${CLEARWAVE_NO_CACHE:-0}"
PRUNE_AFTER="${CLEARWAVE_PRUNE_AFTER:-1}"
SHOW_LOGS="${CLEARWAVE_SHOW_LOGS:-1}"

cd "$PROJECT_DIR"

free_mb() {
  df -Pm "$PROJECT_DIR" | awk 'NR == 2 { print $4 }'
}

print_space() {
  echo ""
  echo "[update] Spazio disco:"
  df -h "$PROJECT_DIR"
  echo ""
  echo "[update] Uso Docker:"
  docker system df || true
}

prune_safe() {
  echo ""
  echo "[update] Pulizia Docker sicura, senza volumi..."
  docker builder prune -af || true
  docker image prune -af || true
  docker container prune -f || true
}

if ! command -v docker >/dev/null 2>&1; then
  echo "[update] Docker non trovato." >&2
  exit 1
fi

print_space

AVAILABLE_MB=$(free_mb)
if [ "$AVAILABLE_MB" -lt "$MIN_FREE_MB" ]; then
  echo "[update] Spazio sotto ${MIN_FREE_MB}MB: pulisco prima della build."
  prune_safe
  AVAILABLE_MB=$(free_mb)
  if [ "$AVAILABLE_MB" -lt "$MIN_FREE_MB" ]; then
    echo "[update] Spazio ancora basso (${AVAILABLE_MB}MB). Libera disco prima di ricostruire." >&2
    exit 1
  fi
fi

echo ""
echo "[update] Aggiorno repository..."
git pull --ff-only

echo ""
if [ "$NO_CACHE" = "1" ]; then
  echo "[update] Build Docker senza cache richiesta da CLEARWAVE_NO_CACHE=1..."
  docker compose build --no-cache "$SERVICE"
else
  echo "[update] Build Docker normale con cache..."
  docker compose build "$SERVICE"
fi

echo ""
echo "[update] Riavvio container..."
docker compose up -d --force-recreate "$SERVICE"

if [ "$PRUNE_AFTER" = "1" ]; then
  prune_safe
fi

print_space

echo ""
echo "[update] Stato container:"
docker compose ps

if [ "$SHOW_LOGS" = "1" ]; then
  echo ""
  echo "[update] Ultimi log:"
  docker compose logs --tail=80 "$SERVICE"
fi

echo ""
echo "[update] Aggiornamento completato."
