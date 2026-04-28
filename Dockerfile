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
    CLEARWAVE_AUTO_EXPAND=0

WORKDIR /app

# Runtime audio lato Raspberry: mpv riproduce sul device del server, ffmpeg aiuta codec/stream.
# yt-dlp viene preso dal rilascio ufficiale piu' recente per evitare errori YouTube da pacchetto Debian vecchio.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl ffmpeg mpv python3 \
  && rm -rf /var/lib/apt/lists/*

RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/bin/yt-dlp \
  && chmod a+rx /usr/bin/yt-dlp \
  && ln -sf /usr/bin/yt-dlp /usr/bin/youtube-dl \
  && ln -sf /usr/bin/yt-dlp /usr/local/bin/yt-dlp \
  && /usr/bin/yt-dlp --version

COPY package.json ./
COPY server.js app.js index.html styles.css ./
COPY assets ./assets
COPY docs ./docs
COPY lib ./lib
COPY partials ./partials
COPY src ./src
COPY styles ./styles
COPY --from=react-builder /app/frontend/dist ./frontend/dist

# Queste cartelle vengono poi normalmente montate come volumi da docker-compose.
RUN mkdir -p /app/data /app/uploads/audio /app/uploads/licenses

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then((r)=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server.js"]
