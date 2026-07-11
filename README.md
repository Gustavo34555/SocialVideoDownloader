# 🎬 Descargador Universal Pro v5.0

Descargador de videos y audio con **fallback a Invidious** para YouTube y **extracción directa de HTML** para carruseles de TikTok. Compatible con **1000+ sitios web**.

Funciona en **local**, **Render**, **Railway**, **VPS** y cualquier servidor Docker.

---

## ✨ Novedades v5.0

- 🌐 **Invidious actualizado**: Instancias verificadas y funcionando en 2026
- 📸 **TikTok Slideshows reescrito**: Extrae imágenes directamente del HTML de TikTok (sin depender de yt-dlp)
- 🔗 **URLs cortas**: Soporta `vt.tiktok.com` y `vm.tiktok.com` resolviendo la redirección automáticamente
- 🛡️ **Anti-bot mejorado**: Extractor `tv` como primario para YouTube
- 🔄 **Auto-fallback**: yt-dlp → Invidious → error con solución

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
2. **yt-dlp** con extractores alternativos (`tv`, `tv_downgraded`, `android_vr`, `web`, `mweb`, `ios`)
3. **Invidious** como fallback automático

Si todo falla, usa el selector **"🌐 Solo Invidious"** en la interfaz.

#### Opción 1: Forzar Invidious (Más sencillo)

Selecciona **"🌐 Solo Invidious"** antes de descargar. Esto evita completamente el bot detection de YouTube.

#### Opción 2: PO Token + Visitor Data

1. Ve a YouTube en tu navegador → F12 → Application → Cookies
2. Copia `VISITOR_INFO1_LIVE` (Visitor Data)
3. En tu app, abre **⚙️ Opciones Avanzadas** → pega ambos valores → Guardar

---

### TikTok: Carruseles de imágenes

**URLs soportadas:**
- `https://www.tiktok.com/@usuario/photo/1234567890`
- `https://vt.tiktok.com/ABC123/` (URL corta)
- `https://vm.tiktok.com/XYZ456/` (URL corta)

**Modos disponibles:**

| Modo | Resultado |
|------|-----------|
| **🎵 Audio solo** | MP3 con la música del carrusel |
| **📸 Imágenes + Audio (ZIP)** | ZIP con todas las imágenes JPG + audio MP3 |

**Cómo funciona internamente:**
1. Resuelve la URL corta (`vt.tiktok.com` → `www.tiktok.com`)
2. Obtiene el HTML de la página de TikTok
3. Extrae las imágenes de los meta tags `og:image` y del JSON de datos SSR
4. Extrae la URL del audio del HTML
5. Descarga todo y empaqueta en ZIP

> **Nota**: yt-dlp NO soporta `/photo/` URLs de TikTok. El servidor usa extracción directa del HTML como workaround.

---

## 📁 Estructura

```
descargador-videos/
├── server.js          # Backend con Invidious + extracción HTML TikTok
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
| **TikTok** | ✅ | ✅ | ✅ | ✅ (ZIP) | yt-dlp / HTML directo |
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
