# 🎬 Descargador Universal Pro v6.0

Descargador de videos y audio impulsado por **yt-dlp**, con fallback **Invidious** para YouTube cuando no hay cookies configuradas.

## ✨ Características

- 🚀 **yt-dlp**: Extractores con evasión de bot detection (`tv_downgraded`, `web`, `android_vr`)
- 🌐 **Invidious**: Fallback sin cookies ni VPN para YouTube
- 🍪 **Cookies opcionales**: vía env var `YOUTUBE_COOKIES` o archivo `cookies.txt`
- 🎨 **UI Dinámica**: Animaciones, partículas, efectos hover, progress bar
- 📺 **Plataformas**: YouTube, TikTok, Instagram, Twitter/X, Facebook, Twitch, SoundCloud, Vimeo, Reddit

## 🚀 Métodos de descarga para YouTube

| Método | Descripción | Cuándo usar |
|--------|-------------|-------------|
| **🌐 Invidious** | Instancias públicas de Invidious (sin cookies) | Sin cookies configuradas |
| **⚡ yt-dlp** | Extractores anti-bot `tv_downgraded` | Con cookies, o si Invidious falla |

Con cookies configuradas se usa yt-dlp directamente. Sin cookies se intenta Invidious primero y, si falla, yt-dlp como fallback.

## 🍪 Cookies (opcional)

Para descargas de YouTube más estables:

```bash
export YOUTUBE_COOKIES="$(cat cookies.txt)"
node server.js
```

O simplemente coloca un archivo `cookies.txt` en la raíz del proyecto. **Importante**: `cookies.txt` nunca debe subirse al repositorio (ya está en `.gitignore`).

## ⚙️ Variables de entorno

| Variable | Default | Descripción |
|----------|---------|-------------|
| `PORT` | `3000` | Puerto del servidor |
| `YOUTUBE_COOKIES` | `-` | Cookies de YouTube (una por línea) |
| `INVIDIOUS_INSTANCES` | 2 públicas | Instancias de Invidious separadas por coma |
| `MAX_CONCURRENT_DOWNLOADS` | `3` | Límite de descargas simultáneas |
| `TRUST_PROXY` | `false` | Ponla en `true` solo si el servidor está detrás de un proxy/reverse (Render, Nginx). En `false` se ignora `X-Forwarded-For`, evitando spoofing del rate limit. |

## 🛠️ Inicio rápido

### Docker (Recomendado)
```bash
docker build -t descargador-pro .
docker run -p 3000:3000 descargador-pro
```

La imagen instala vía pip la versión **anclada** de `yt-dlp` (`==2026.07.04`, revisa `Dockerfile`) junto al plugin **`bgutil-ytdlp-pot-provider`** (tokens PO anti bot detection). Si actualizas `yt-dlp`, verifica contra YouTube antes de desplegar:

```bash
yt-dlp --version
yt-dlp --dump-json --simulate --js-runtimes node --force-ipv4 \
  --extractor-args "youtube:player_client=web,android_vr" \
  "https://www.youtube.com/watch?v=dQw4w9WgXcQ" | jq .title
```

### Node.js directo
```bash
npm install
node server.js
```

Abre http://localhost:3000

## 🌍 Despliegue en Render

Render despliega el `Dockerfile` tal cual: `yt-dlp 2026.07.04` + plugin PO Token + Node 20.

1. **`TRUST_PROXY=true`**: Render sirve tu app detrás de su proxy, así que debe respetar `X-Forwarded-For`. Fuera de Render se deja en `false` para evitar spoofing del rate limit.
2. **Verifica el deploy**: abre `https://TU_APP.onrender.com/health` → debe responder `ytDlp: true`, `ffmpeg: true`.
3. **Bot detection**: las IPs de Render (datacenter AWS) pueden caer en "Sign in to confirm you're not a bot". La app entonces usa el fallback Invidious automáticamente; si Invidious tampoco responde, setea `YOUTUBE_COOKIES` (sección de arriba).
