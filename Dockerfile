# ═══════════════════════════════════════════
# Descargador Universal Pro v3.0
# Anti-bot + TikTok Slideshows
# ═══════════════════════════════════════════

FROM node:20-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive
ENV NODE_ENV=production
ENV PYTHONUNBUFFERED=1

# ─── Dependencias del sistema ───
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    python3-venv \
    python3-pip \
    curl \
    ca-certificates \
    wget \
    git \
    zip \
    && rm -rf /var/lib/apt/lists/*

# ─── yt-dlp en virtualenv ───
RUN python3 -m venv /opt/yt-dlp-venv \
    && /opt/yt-dlp-venv/bin/pip install --no-cache-dir --upgrade pip \
    && /opt/yt-dlp-venv/bin/pip install --no-cache-dir "yt-dlp>=2025.07.01" \
    && ln -sf /opt/yt-dlp-venv/bin/yt-dlp /usr/local/bin/yt-dlp \
    && chmod +x /opt/yt-dlp-venv/bin/yt-dlp

# ─── Verificar ───
RUN yt-dlp --version && ffmpeg -version | head -1

WORKDIR /app
RUN mkdir -p /app/cookies /app/tokens /tmp/ytdl

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

EXPOSE 3000

CMD ["sh", "-c", "echo '[docker] Actualizando yt-dlp...' && yt-dlp -U 2>/dev/null || true && yt-dlp --rm-cache-dir 2>/dev/null || true && echo '[docker] Iniciando servidor...' && node server.js"]
