# 🎬 Descargador Universal Pro v6.0

Descargador de videos y audio con **múltiples métodos anti-bot** para YouTube y **extracción directa de HTML** para carruseles de TikTok.

## ✨ Novedades v6.0

- 🚀 **Cobalt API**: Nuevo método de descarga que evita completamente el bot detection de YouTube
- 🌐 **Invidious**: Fallback con instancias actualizadas
- ⚡ **yt-dlp**: Extractor `tv` como primario para datacenters
- 📸 **TikTok Slideshows**: Extracción directa del HTML (soporta URLs cortas `vt.tiktok.com`)
- 🎨 **UI Dinámica**: Animaciones, partículas, efectos hover, progress bar

## 🚀 Métodos de descarga para YouTube

| Método | Descripción | Cuándo usar |
|--------|-------------|-------------|
| **⚡ Auto** | Intenta yt-dlp → Cobalt → Invidious automáticamente | Por defecto |
| **🚀 Cobalt** | API de cobalt.tools, sin bot detection | Si Auto falla |
| **🌐 Invidious** | Instancias públicas de Invidious | Si Cobalt falla |

## 🛠️ Inicio rápido

### Docker (Recomendado)
```bash
docker build -t descargador-pro .
docker run -p 3000:3000 descargador-pro
```

### Node.js directo
```bash
npm install
node server.js
```

Abre http://localhost:3000

## 📸 TikTok Slideshows

Soporta:
- `https://www.tiktok.com/@user/photo/1234567890`
- `https://vt.tiktok.com/ABC123/` (URL corta)
- `https://vm.tiktok.com/XYZ456/` (URL corta)

Modos:
- 🎵 **Audio solo**: MP3 con la música
- 📸 **Imágenes + Audio (ZIP)**: Todas las imágenes + audio
