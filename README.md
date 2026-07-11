# 🎬 Descargador Universal Pro v4.0

Descargador de videos y audio con **fallback a Invidious** para YouTube, **anti-bot con PO Token**, y **soporte completo para carruseles de TikTok**. Compatible con **1000+ sitios web**.

Funciona en **local**, **Render**, **Railway**, **VPS** y cualquier servidor Docker.

---

## ✨ Novedades v4.0

- 🌐 **Fallback a Invidious**: Si YouTube bloquea yt-dlp, descarga automáticamente vía instancias de Invidious
- 🎛️ **Modo Solo Invidious**: Forzar el uso de Invidious para evitar completamente el bot detection
- 🛡️ **Anti-bot**: PO Token + Visitor Data + 6 extractores con fallback
- 📸 **TikTok Slideshows**: Descarga imágenes de carruseles + audio en ZIP
- 🔄 **Auto-fallback**: yt-dlp → Invidious → error con tip de solución

---

## 🚀 Despliegue Rápido

### Render

1. Sube el código a GitHub
2. En Render Dashboard → **New Web Service** → Conecta tu repo
3. Render detecta el `Dockerfile` automáticamente
4. Accede a `https://tu-app.onrender.com`

### Local

```bash
docker build -t descargador-pro .
docker run -p 3000:3000 descargador-pro
```

---

## 🛠️ Solución de Problemas

### YouTube: "Sign in to confirm you're not a bot"

El servidor intenta **3 niveles** automáticamente:

1. **yt-dlp** con cookies + PO Token (si están configurados)
2. **yt-dlp** con extractores alternativos (tv, android_vr, mweb, ios...)
3. **Invidious** como fallback automático

Si todo falla, puedes **forzar Invidious** con el selector "🌐 Solo Invidious" en la interfaz.

#### Opción 1: Forzar Invidious (Más sencillo)

En la interfaz, selecciona **"🌐 Solo Invidious"** antes de descargar. Esto evita completamente el bot detection de YouTube al usar instancias públicas de Invidious como proxy.

#### Opción 2: PO Token + Visitor Data

1. Ve a YouTube en tu navegador → F12 → Application → Cookies
2. Copia `VISITOR_INFO1_LIVE` (Visitor Data) y genera el PO Token
3. Pégalo en **Opciones Avanzadas** → Guardar tokens

#### Opción 3: Cookies

1. Instala **"Get cookies.txt LOCALLY"**
2. Exporta cookies de YouTube en formato Netscape
3. Pégalo en Opciones Avanzadas → Guardar cookies

---

### TikTok: Carruseles de imágenes (/photo/)

Los enlaces `tiktok.com/@user/photo/123` son slideshows. La app detecta automáticamente estos enlaces y ofrece:

| Modo | Resultado |
|------|-----------|
| **🎵 Audio solo** | MP3 con la música del carrusel |
| **📸 Imágenes + Audio (ZIP)** | ZIP con todas las imágenes JPG + audio MP3 |

---

## 📁 Estructura

```
descargador-videos/
├── server.js          # Backend con Invidious fallback
├── index.html         # Frontend con selector de método
├── Dockerfile         # Node 20 + ffmpeg + yt-dlp
├── package.json       # Dependencias (archiver)
├── render.yaml        # Config Render
├── cookies/           # Cookies de navegador
├── tokens/            # PO Token + Visitor Data
└── README.md
```

---

## 🌐 Sitios Soportados

| Plataforma | Videos | Audio | Shorts | Slideshows | Método |
|------------|--------|-------|--------|------------|--------|
| **YouTube** | ✅ | ✅ | ✅ | ❌ | yt-dlp / Invidious |
| **TikTok** | ✅ | ✅ | ✅ | ✅ (ZIP) | yt-dlp |
| **Instagram** | ✅ | ✅ | ✅ | ❌ | yt-dlp |
| **Facebook** | ✅ | ✅ | ✅ | ❌ | yt-dlp |
| **X/Twitter** | ✅ | ✅ | ✅ | ❌ | yt-dlp |
| **Reddit** | ✅ | ✅ | ❌ | ❌ | yt-dlp |
| **Twitch** | ✅ | ✅ | ✅ | ❌ | yt-dlp |
| **Vimeo** | ✅ | ✅ | ❌ | ❌ | yt-dlp |
| **SoundCloud** | ❌ | ✅ | ❌ | ❌ | yt-dlp |

---

## ⚠️ Disclaimer

Herramienta para descargar contenido del cual tienes derecho. Respeta los Términos de Servicio y las leyes de copyright.
