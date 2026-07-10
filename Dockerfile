# 1. Usar Linux con Node.js preinstalado
FROM node:18-bullseye-slim

# 2. Instalar FFmpeg, Python y curl
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# 3. Instalar yt-dlp desde PyPI sin usar --break-system-packages
#    (pip en bullseye es viejo y no soporta esa opción).
#    Se instala en un virtualenv y se hace symlink a /usr/local/bin
RUN python3 -m venv /opt/yt-dlp-venv \
    && /opt/yt-dlp-venv/bin/pip install --no-cache-dir --upgrade pip \
    && /opt/yt-dlp-venv/bin/pip install --no-cache-dir "yt-dlp>=2025.01.01" \
    && ln -sf /opt/yt-dlp-venv/bin/yt-dlp /usr/local/bin/yt-dlp \
    && chmod +x /opt/yt-dlp-venv/bin/yt-dlp

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
