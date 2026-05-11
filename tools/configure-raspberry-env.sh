#!/bin/sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"
EXAMPLE_FILE="$ROOT_DIR/.env.example"

if [ ! -f "$ENV_FILE" ]; then
  cp "$EXAMPLE_FILE" "$ENV_FILE"
  echo "[env] Creato .env da .env.example"
else
  BACKUP_FILE="$ROOT_DIR/.env.backup-$(date +%Y%m%d-%H%M%S)"
  cp "$ENV_FILE" "$BACKUP_FILE"
  echo "[env] Backup creato: $BACKUP_FILE"
fi

set_env() {
  key="$1"
  value="$2"
  tmp_file="$(mktemp)"

  awk -v key="$key" -v value="$value" '
    BEGIN { done = 0 }
    $0 ~ "^" key "=" {
      print key "=" value
      done = 1
      next
    }
    { print }
    END {
      if (!done) {
        print key "=" value
      }
    }
  ' "$ENV_FILE" > "$tmp_file"

  mv "$tmp_file" "$ENV_FILE"
}

# Raspberry audio e Docker.
set_env CLEARWAVE_DOCKER_PRIVILEGED true
set_env CLEARWAVE_SERVER_PLAYER 1
set_env CLEARWAVE_UPDATE_YTDLP_ON_START 1
set_env CLEARWAVE_AUDIO_OUTPUT alsa
set_env CLEARWAVE_AUDIO_PREFLIGHT 1
set_env CLEARWAVE_YTDL_PATH /usr/bin/yt-dlp
set_env CLEARWAVE_YTDL_FORMAT "bestaudio[acodec!=none]/bestaudio/best[acodec!=none]/best"
set_env CLEARWAVE_YTDL_COOKIES_FILE ""
set_env CLEARWAVE_MPV_MSG_LEVEL "all=warn,ytdl_hook=info"

# Gain volume server: mantiene lo slider 0..100 ma alza leggermente mpv/ALSA.
set_env CLEARWAVE_SERVER_VOLUME_GAIN 1.15
set_env CLEARWAVE_SERVER_VOLUME_MAX 130

# Check automatico catalogo: parte in background e salva report in data/reports.
set_env CLEARWAVE_AUDIO_CHECK_ENABLED 1
set_env CLEARWAVE_AUDIO_CHECK_ON_START 1
set_env CLEARWAVE_AUDIO_CHECK_MODE probe
set_env CLEARWAVE_AUDIO_CHECK_INTERVAL_HOURS 24
set_env CLEARWAVE_AUDIO_CHECK_CONCURRENCY 2
set_env CLEARWAVE_AUDIO_CHECK_TIMEOUT_MS 30000
set_env CLEARWAVE_AUDIO_CHECK_SAMPLE_SECONDS 6
set_env CLEARWAVE_AUDIO_CHECK_ONLY_ERRORS 1

echo "[env] Configurazione Raspberry aggiornata in $ENV_FILE"
