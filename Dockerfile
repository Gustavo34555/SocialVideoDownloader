# Sistema operativo base ultraligero
FROM node:18-bullseye-slim

# Instalación de dependencias del sistema (FFmpeg y Python son vitales para yt-dlp)
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Descarga de la versión Nightly de yt-dlp (Anti-bloqueos)
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/download/nightly/yt-dlp -o /usr/local/bin/yt-dlp \
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