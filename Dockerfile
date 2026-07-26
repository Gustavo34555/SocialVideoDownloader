FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    python3-pip \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Instalar plugin PO Token para YouTube (evita deteccion de bots en servidores)
RUN pip3 install --break-system-packages bgutil-ytdlp-pot-provider

# yt-dlp estable
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/download/2026.07.04/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp

WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
