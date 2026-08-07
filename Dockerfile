FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    python3-pip \
    curl \
    && rm -rf /var/lib/apt/lists/*

# yt-dlp + plugin PO Token via pip (mejor integracion que el binario)
RUN pip3 install --break-system-packages \
    yt-dlp==2026.07.04 \
    bgutil-ytdlp-pot-provider

WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 3000
CMD ["node", "server.js"]
