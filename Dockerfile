# 1. Usar Linux con Node.js preinstalado
FROM node:18-bullseye-slim

# 2. Instalar FFmpeg y Python (necesario para yt-dlp)
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# 3. Descargar e instalar la última versión de yt-dlp
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp

# 4. Crear la carpeta donde vivirá tu código
WORKDIR /app

# 5. Copiar los archivos de configuración e instalar librerías (Express, Cors, Archiver)
COPY package*.json ./
RUN npm install

# 6. Copiar el resto de tu código (server.js, index.html)
COPY . .

# 7. Exponer el puerto
EXPOSE 3000

# 8. Encender el servidor
CMD ["node", "server.js"]