# 1. Usar Linux con Node.js preinstalado
FROM node:18-bullseye-slim

# 2. Instalar FFmpeg, Python (con venv), pip y curl
#    python3-venv es un paquete separado en Debian y necesario para crear el venv
#    DEBIAN_FRONTEND=noninteractive evita que debconf pida input y cuelgue el build
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y \
    ffmpeg \
    python3 \
    python3-venv \
    python3-pip \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# 3. Instalar yt-dlp en un virtualenv (sin usar --break-system-packages,
#    que pip 20.x de bullseye no soporta)
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
