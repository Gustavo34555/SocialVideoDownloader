# ═══════════════════════════════════════════
# Descargador Universal Pro - Dockerfile
# Optimizado para Render, Railway, VPS, Local
# ═══════════════════════════════════════════

FROM node:20-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive
ENV NODE_ENV=production
ENV PYTHONUNBUFFERED=1

# ─── Instalar dependencias del sistema ───
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    python3-venv \
    python3-pip \
    curl \
    ca-certificates \
    wget \
    git \
    && rm -rf /var/lib/apt/lists/*

# ─── Instalar yt-dlp en virtualenv (más estable) ───
# Usamos la última versión estable. En producción, yt-dlp se auto-actualiza.
RUN python3 -m venv /opt/yt-dlp-venv \
    && /opt/yt-dlp-venv/bin/pip install --no-cache-dir --upgrade pip \
    && /opt/yt-dlp-venv/bin/pip install --no-cache-dir "yt-dlp>=2025.07.01" \
    && ln -sf /opt/yt-dlp-venv/bin/yt-dlp /usr/local/bin/yt-dlp \
    && chmod +x /opt/yt-dlp-venv/bin/yt-dlp

# ─── Verificar instalación (falla el build si no existe) ───
RUN yt-dlp --version && ffmpeg -version | head -1

# ─── Crear directorios de trabajo ───
WORKDIR /app
RUN mkdir -p /app/cookies /tmp/ytdl

# ─── Instalar dependencias Node ───
COPY package*.json ./
RUN npm install --omit=dev

# ─── Copiar código fuente ───
COPY . .

# ─── Exponer puerto ───
EXPOSE 3000

# ─── Comando de inicio ───
# 1. Actualiza yt-dlp a la última versión (crítico para extractores que cambian)
# 2. Limpia caché vieja de yt-dlp
# 3. Inicia el servidor Node
CMD ["sh", "-c", "echo '[docker] Actualizando yt-dlp...' && yt-dlp -U 2>/dev/null || true && yt-dlp --rm-cache-dir 2>/dev/null || true && echo '[docker] Iniciando servidor...' && node server.js"]
