# Node 20 LTS sobre Debian 12 (Bookworm)
FROM node:20-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

# Instalar FFmpeg, Python y herramientas esenciales
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    python3-venv \
    python3-pip \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Instalar yt-dlp en un virtualenv (sin tocar el sistema)
RUN python3 -m venv /opt/yt-dlp-venv \
    && /opt/yt-dlp-venv/bin/pip install --no-cache-dir --upgrade pip \
    && /opt/yt-dlp-venv/bin/pip install --no-cache-dir "yt-dlp>=2025.07.01" \
    && ln -sf /opt/yt-dlp-venv/bin/yt-dlp /usr/local/bin/yt-dlp \
    && chmod +x /opt/yt-dlp-venv/bin/yt-dlp

# Verificar que ambos binarios existen (falla el build si no)
RUN yt-dlp --version && ffmpeg -version | head -1

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

EXPOSE 3000

# Al arrancar: actualiza yt-dlp y luego inicia el servidor
CMD ["sh", "-c", "yt-dlp -U 2>/dev/null || true && node server.js"]