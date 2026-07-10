# SocialVideoDownloader

Descargador de videos y audio de redes sociales (YouTube, TikTok, Instagram, Facebook, X, Reddit, Twitch, Vimeo y más) usando `yt-dlp` + `ffmpeg` corriendo detrás de un servidor Express.

## ✨ Características

- Analiza un enlace y lista todas las calidades/formatos disponibles
- Descarga video o audio en la calidad que elijas
- Mux automático (combina video DASH con audio)
- UI oscura y responsive (sin frameworks)
- Funciona idéntico en **local** y en **Render**

## 🚀 Correr en local

### Requisitos

- **Node.js 18+** → https://nodejs.org
- **yt-dlp** → https://github.com/yt-dlp/yt-dlp/releases
- **ffmpeg** → https://ffmpeg.org/download.html (yt-dlp lo necesita para mux/recodificación)

Verifica instalación:

```bash
node --version
yt-dlp --version
ffmpeg -version
```

### Pasos

```bash
# 1. Clonar
git clone https://github.com/Gustavo34555/SocialVideoDownloader.git
cd SocialVideoDownloader

# 2. Instalar dependencias de Node
npm install

# 3. Iniciar el servidor
npm start
```

Abrí `http://localhost:3000` y listo. Si el puerto 3000 está ocupado, podés usar otro:

```bash
# Windows (PowerShell)
$env:PORT=4000; npm start

# macOS / Linux
PORT=4000 npm start
```

## ☁️ Deploy en Render

Hay dos caminos, ambos funcionan:

### Opción A — Usar el `render.yaml` (recomendado)

1. En https://render.com → **New** → **Blueprint**
2. Conectá este repositorio: `Gustavo34555/SocialVideoDownloader`
3. Render detecta `render.yaml` y crea el servicio automáticamente
4. Cada push a `main` redespliega

### Opción B — Crear el Web Service a mano

1. En https://render.com → **New** → **Web Service**
2. Conectá el repo
3. Configurá:

| Campo           | Valor            |
| --------------- | ---------------- |
| Runtime         | **Docker**       |
| Branch          | `main`           |
| Region          | Oregon (US West) |
| Plan            | Free             |
| Health Check    | `/`              |

4. Click **Create Web Service**

> El `Dockerfile` ya instala `yt-dlp` y `ffmpeg` dentro de la imagen, así que no hay que configurar nada extra en Render.

## 🔗 Vinculado con GitHub

```bash
git remote add origin https://github.com/Gustavo34555/SocialVideoDownloader.git
git push -u origin main
```

## 📁 Estructura

```
.
├── server.js          # Servidor Express + lógica de yt-dlp
├── index.html         # UI del descargador
├── package.json       # Dependencias y scripts
├── Dockerfile         # Imagen con Node + ffmpeg + yt-dlp
├── render.yaml        # Configuración de deploy en Render
├── .dockerignore      # Archivos ignorados por Docker
└── .gitignore         # node_modules, etc.
```

## ⚠️ Aviso

Descargá solo contenido que tengas derecho a descargar. Respetá los términos de servicio de cada plataforma y las leyes de copyright de tu país.
