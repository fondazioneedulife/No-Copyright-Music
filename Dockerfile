# Build della UI React: Vite genera frontend/dist, poi il backend Node la serve da /react/.
FROM node:22-bookworm-slim AS react-builder

WORKDIR /app

COPY frontend/package*.json ./frontend/
RUN npm ci --prefix frontend

COPY frontend ./frontend
RUN npm --prefix frontend run build

# Runtime finale: contiene backend, build React principale e legacy solo come fallback.
FROM node:22-bookworm-slim

ENV NODE_ENV=production \
    PORT=3000 \
    CLEARWAVE_DATA_DIR=/app/data \
    CLEARWAVE_UPLOADS_DIR=/app/uploads \
    CLEARWAVE_ENABLE_DEMOS=0 \
    CLEARWAVE_AUTO_EXPAND=0 \
    CLEARWAVE_UPDATE_YTDLP_ON_START=1 \
    CLEARWAVE_YTDLP_DOWNLOAD_URL=https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download/yt-dlp \
    CLEARWAVE_YTDL_JS_RUNTIME=deno:/usr/local/bin/deno \
    CLEARWAVE_YTDL_EXTRACTOR_ARGS=youtube:player_client=mweb \
    CLEARWAVE_YTDL_PO_TOKEN_CLIENT=mweb.gvs \
    CLEARWAVE_YTDL_BGUTIL_PROVIDER=1 \
    CLEARWAVE_YTDL_BGUTIL_PORT=4416 \
    CLEARWAVE_YTDL_BGUTIL_VERSION=1.3.1

WORKDIR /app

# Runtime audio lato Raspberry: mpv riproduce sul device del server, ffmpeg aiuta codec/stream.
# Deno serve a yt-dlp come runtime JavaScript per i nuovi controlli YouTube anti-bot/signature.
# yt-dlp viene preso dal rilascio ufficiale piu' recente per evitare errori YouTube da pacchetto Debian vecchio.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl ffmpeg mpv python3 alsa-utils libasound2-plugins unzip \
  && rm -rf /var/lib/apt/lists/*

RUN set -eux; \
  arch="$(dpkg --print-architecture)"; \
  case "$arch" in \
    amd64) deno_arch="x86_64-unknown-linux-gnu" ;; \
    arm64) deno_arch="aarch64-unknown-linux-gnu" ;; \
    *) echo "Architettura Deno non supportata: $arch" >&2; exit 1 ;; \
  esac; \
  curl -fL "https://github.com/denoland/deno/releases/latest/download/deno-${deno_arch}.zip" -o /tmp/deno.zip; \
  unzip -q /tmp/deno.zip -d /usr/local/bin; \
  chmod a+rx /usr/local/bin/deno; \
  rm -f /tmp/deno.zip; \
  /usr/local/bin/deno --version

RUN curl -L "${CLEARWAVE_YTDLP_DOWNLOAD_URL}" -o /usr/bin/yt-dlp \
  && chmod a+rx /usr/bin/yt-dlp \
  && ln -sf /usr/bin/yt-dlp /usr/bin/youtube-dl \
  && ln -sf /usr/bin/yt-dlp /usr/local/bin/yt-dlp \
  && /usr/bin/yt-dlp --version

# Provider PO token in-process: evita un secondo container e aiuta YouTube quando cookie validi ricevono 403 GVS.
RUN set -eux; \
  mkdir -p /etc/yt-dlp/plugins /opt; \
  curl -fL "https://github.com/Brainicism/bgutil-ytdlp-pot-provider/releases/download/${CLEARWAVE_YTDL_BGUTIL_VERSION}/bgutil-ytdlp-pot-provider.zip" \
    -o /etc/yt-dlp/plugins/bgutil-ytdlp-pot-provider.zip; \
  curl -fL "https://github.com/Brainicism/bgutil-ytdlp-pot-provider/archive/refs/tags/${CLEARWAVE_YTDL_BGUTIL_VERSION}.tar.gz" \
    -o /tmp/bgutil-ytdlp-pot-provider.tar.gz; \
  tar -xzf /tmp/bgutil-ytdlp-pot-provider.tar.gz -C /opt; \
  mv "/opt/bgutil-ytdlp-pot-provider-${CLEARWAVE_YTDL_BGUTIL_VERSION}" /opt/bgutil-ytdlp-pot-provider; \
  cd /opt/bgutil-ytdlp-pot-provider/server; \
  npm ci --include=dev; \
  if [ -x ./node_modules/.bin/tsc ]; then ./node_modules/.bin/tsc; else npx --yes --package typescript@5.9.3 tsc; fi; \
  npm prune --omit=dev; \
  rm -f /tmp/bgutil-ytdlp-pot-provider.tar.gz

COPY package.json ./
COPY server.js app.js index.html styles.css ./
COPY assets ./assets
COPY docs ./docs
COPY lib ./lib
COPY tools ./tools
COPY partials ./partials
COPY src ./src
COPY styles ./styles
COPY --from=react-builder /app/frontend/dist ./frontend/dist

# Queste cartelle vengono poi normalmente montate come volumi da docker-compose.
RUN mkdir -p /app/data /app/uploads/audio /app/uploads/licenses

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["sh", "-c", "if [ \"${CLEARWAVE_YTDL_BGUTIL_PROVIDER:-1}\" = \"1\" ]; then echo '[startup] Avvio provider PO token bgutil...'; node /opt/bgutil-ytdlp-pot-provider/server/build/main.js --port \"${CLEARWAVE_YTDL_BGUTIL_PORT:-4416}\" & sleep 1; fi; if [ \"${CLEARWAVE_UPDATE_YTDLP_ON_START:-1}\" = \"1\" ]; then echo '[startup] Controllo aggiornamento yt-dlp...'; if curl -fL \"${CLEARWAVE_YTDLP_DOWNLOAD_URL:-https://github.com/yt-dlp/yt-dlp-nightly-builds/releases/latest/download/yt-dlp}\" -o /tmp/yt-dlp.new; then chmod a+rx /tmp/yt-dlp.new && mv /tmp/yt-dlp.new /usr/bin/yt-dlp && ln -sf /usr/bin/yt-dlp /usr/bin/youtube-dl && ln -sf /usr/bin/yt-dlp /usr/local/bin/yt-dlp && echo '[startup] yt-dlp aggiornato:' && /usr/bin/yt-dlp --version; else echo '[startup] yt-dlp non aggiornato: uso quello gia presente.'; rm -f /tmp/yt-dlp.new; fi; fi; exec node server.js"]
