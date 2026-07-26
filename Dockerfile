# Sistema operativo base ultraligero
FROM node:20-bookworm-slim

# Instalación de dependencias del sistema (FFmpeg y Python son vitales para yt-dlp)
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Descarga de yt-dlp estable (version fija para builds reproducibles)
# Actualizar esta version periodicamente cuando haya nuevas releases
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/download/2026.07.04/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp

# Crear y establecer el directorio de trabajo
WORKDIR /app

# Instalar los paquetes de Node
COPY package*.json ./
RUN npm install

# Copiar el resto del código (server.js, index.html, cookies.txt)
COPY . .

# Exponer el puerto web
EXPOSE 3000

# Encender el servidor
CMD ["node", "server.js"]