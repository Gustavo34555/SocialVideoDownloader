# 🎬 Descargador Universal Pro

Descargador de videos y audio compatible con **YouTube, TikTok, Instagram, X/Twitter, Facebook, Reddit, Twitch, Vimeo, SoundCloud** y más de **1.000 sitios web** gracias a [yt-dlp](https://github.com/yt-dlp/yt-dlp).

Diseñado para funcionar tanto en **local** como en **Render, Railway, VPS y cualquier servidor Docker**.

---

## ✨ Características

- ✅ **Multiplataforma**: YouTube, TikTok, Instagram, X, Facebook, Reddit, Twitch, Vimeo, SoundCloud, Bilibili, Dailymotion...
- 🛡️ **Anti-bloqueo**: Rotación automática de extractores para evitar "Sign in to confirm you're not a bot" en YouTube
- 🍪 **Soporte de cookies**: Sube cookies de tu navegador para evitar bloqueos en IPs de datacenter
- 📸 **Detección de slideshows**: Identifica carruseles de imágenes (TikTok/Instagram) y advierte al usuario
- 🔄 **Fallback inteligente**: Si una estrategia falla, prueba automáticamente con otra configuración
- 🧹 **Limpieza automática**: Archivos temporales se eliminan después de cada descarga
- 🚀 **Docker optimizado**: Imagen ligera basada en Node 20 + Debian 12
- 📱 **Responsive**: Interfaz moderna y adaptable a móviles

---

## 🚀 Despliegue Rápido

### Opción A: Render (Recomendado)

1. Haz fork de este repo o súbelo a GitHub
2. En [Render Dashboard](https://dashboard.render.com) → **New Web Service**
3. Conecta tu repositorio
4. Render detectará automáticamente el `Dockerfile`
5. ¡Listo! El servicio se despliega en `https://tu-app.onrender.com`

> **Importante**: Render usa IPs de datacenter. YouTube puede bloquear descargas. Ve a la sección [Cookies](#cookies) para solucionarlo.

### Opción B: Local / VPS

```bash
# 1. Clonar
git clone <repo>
cd descargador-videos

# 2. Construir imagen Docker
docker build -t descargador-pro .

# 3. Ejecutar
docker run -p 3000:3000 descargador-pro

# 4. Abrir navegador
open http://localhost:3000
```

### Opción C: Node.js directo (sin Docker)

Requisitos: Node.js 18+, Python 3, FFmpeg, yt-dlp

```bash
npm install
node server.js
```

---

## 🛠️ Solución de Problemas

### "Sign in to confirm you're not a bot" (YouTube)

Este error ocurre porque **YouTube bloquea IPs de datacenter** (Render, AWS, Google Cloud, etc.). No basta con cookies en muchos casos, pero hay varias soluciones:

#### Solución 1: Cookies de navegador (Recomendada para empezar)

1. Instala la extensión **"Get cookies.txt LOCALLY"** en Chrome/Firefox
2. Ve a YouTube y reproduce cualquier video
3. Exporta las cookies en formato **Netscape**
4. En la app, abre **Opciones Avanzadas** y pega el contenido
5. Guarda las cookies y vuelve a intentar

#### Solución 2: Cloudflare WARP (Para servidores cloud)

Si las cookies no funcionan, necesitas enmascarar tu IP. La forma más fácil y gratuita es **Cloudflare WARP**:

```bash
# En tu servidor (requiere privilegios o Docker)
docker run -d --name warp -p 1080:1080 ghcr.io/kingcc/warproxy:latest

# Luego modifica server.js para usar proxy:
# Añade '--proxy', 'socks5://127.0.0.1:1080' a los args de yt-dlp
```

#### Solución 3: Proxy residencial (Garantizado pero de pago)

Servicios como **Bright Data**, **Oxylabs** o **Webshare** ofrecen proxies residenciales que funcionan 100% con YouTube.

```bash
# Añade a las estrategias de server.js:
# '--proxy', 'http://usuario:pass@proxy-residencial.com:8080'
```

#### Solución 4: PO Token (Método avanzado 2026)

yt-dlp soporta **Proof-of-Origin Tokens** para demostrar que no eres un bot:

```bash
# Instalar plugin (dentro del contenedor)
pip install bgutil-ytdlp-pot-provider

# El servidor ya intenta múltiples clientes (tv_downgraded, web, android_vr, etc.)
# automáticamente sin necesidad de configuración manual.
```

---

### "Unsupported URL" en TikTok (/photo/...)

Los enlaces de **TikTok Photo** son carruseles de imágenes, no videos. yt-dlp tiene soporte limitado para estos.

**Solución**: Usa enlaces de **TikTok Video** (`/video/`) en lugar de `/photo/`.

El servidor detecta automáticamente slideshows y muestra una advertencia.

---

### "Timeout: la operación tardó demasiado"

- YouTube/Instagram pueden estar bloqueando la IP del servidor
- Intenta subir cookies
- Si el video es muy largo (>30 min), aumenta el timeout en `server.js` (línea `timeout = 300000`)

---

### "El archivo descargado está vacío"

- yt-dlp pudo haber fallado silenciosamente
- Revisa los logs del servidor (`docker logs <container>`)
- Asegúrate de que FFmpeg esté instalado (el Dockerfile ya lo incluye)

---

## 📁 Estructura del Proyecto

```
descargador-videos/
├── server.js          # Backend Express + yt-dlp
├── index.html         # Frontend completo
├── Dockerfile         # Imagen Docker optimizada
├── package.json       # Dependencias Node
├── render.yaml        # Configuración para Render.com
├── cookies/           # Cookies de navegador (no subir a git)
├── .gitignore
└── .dockerignore
```

---

## 🔧 Variables de Entorno

| Variable | Default | Descripción |
|----------|---------|-------------|
| `PORT` | `3000` | Puerto del servidor |
| `TMP_DIR` | `/tmp/ytdl` | Directorio de archivos temporales |
| `NODE_ENV` | `production` | Modo de ejecución |

---

## 🌐 Sitios Soportados

yt-dlp soporta más de **1.000 sitios web**. Los principales:

| Plataforma | Videos | Audio | Shorts/Reels | Notas |
|------------|--------|-------|--------------|-------|
| **YouTube** | ✅ | ✅ | ✅ | Puede requerir cookies en datacenter |
| **TikTok** | ✅ | ✅ | ✅ | Photos/slideshows: soporte limitado |
| **Instagram** | ✅ | ✅ | ✅ | Reels y posts públicos |
| **Facebook** | ✅ | ✅ | ✅ | Videos públicos y Watch |
| **X/Twitter** | ✅ | ✅ | ✅ | Incluye Spaces |
| **Reddit** | ✅ | ✅ | ❌ | Videos y GIFs |
| **Twitch** | ✅ | ✅ | ✅ | VODs y clips |
| **Vimeo** | ✅ | ✅ | ❌ | |
| **SoundCloud** | ❌ | ✅ | ❌ | Solo audio |
| **Bilibili** | ✅ | ✅ | ❌ | |
| **Dailymotion** | ✅ | ✅ | ❌ | |

Para la lista completa: [yt-dlp supported sites](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md)

---

## 🔄 Actualización de yt-dlp

Los extractores de sitios web cambian constantemente. yt-dlp se **auto-actualiza** al arrancar el contenedor:

```bash
# Manualmente dentro del contenedor:
docker exec -it <container> yt-dlp -U
```

El Dockerfile ejecuta `yt-dlp -U` automáticamente en cada reinicio.

---

## 📝 Licencia

MIT - Uso libre para proyectos personales y comerciales.

---

## ⚠️ Disclaimer

Este proyecto es una herramienta de descarga para contenido del cual tienes derecho a descargar. No nos hacemos responsables del uso indebido. Respeta los Términos de Servicio de cada plataforma y las leyes de copyright de tu país.
