# 1. Usar Linux con Node.js preinstalado
FROM node:18-bullseye-slim

# 2. Instalar FFmpeg y Python (necesario para yt-dlp)
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    python3-pip \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# 3. Instalar yt-dlp con pip (más confiable que descargar binario de "latest")
#    Si pip falla, cae al binario con versión fija como respaldo
RUN pip3 install --no-cache-dir --break-system-packages yt-dlp \
    || curl -L https://github.com/yt-dlp/yt-dlp/releases/download/2025.01.01/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp

# 4. Verificar que yt-dlp y ffmpeg están disponibles (falla el build si no)
RUN yt-dlp --version && ffmpeg -version | head -1

# 5. Crear la carpeta donde vivirá tu código
WORKDIR /app

# 6. Copiar los archivos de configuración e instalar librerías
COPY package*.json ./
RUN npm install --omit=dev

# 7. Copiar el resto del código
COPY . .

# 8. Exponer el puerto
EXPOSE 3000

# 9. Encender el servidor
CMD ["node", "server.js"]
