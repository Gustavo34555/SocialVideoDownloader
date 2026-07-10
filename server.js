const express = require('express');
const cors = require('cors');
const { spawn, execFile } = require('child_process');
const https = require('https');
const http = require('http');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));
app.use(express.static(__dirname));

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// =======================================================================
// RESOLUCIÓN DE URL
// Sigue los redirects HTTP manualmente para enlaces cortos (TikTok, etc.)
// y limpia parámetros de seguimiento que confunden a los extractores.
// =======================================================================

function followRedirect(url, depth = 0) {
    return new Promise((resolve, reject) => {
        if (depth > 10) return reject(new Error('Demasiados redirects'));
        const proto = url.startsWith('https') ? https : http;
        const req = proto.get(url, {
            headers: {
                'User-Agent': USER_AGENT,
                'Accept-Language': 'en-US,en;q=0.9',
                'Accept': '*/*',
                'Accept-Encoding': 'identity',
            }
        }, response => {
            response.resume();
            if (response.statusCode && [301, 302, 303, 307, 308].includes(response.statusCode)) {
                const loc = response.headers.location;
                if (!loc) return reject(new Error('Redirect sin Location'));
                const next = loc.startsWith('http') ? loc : new URL(loc, url).toString();
                return resolve(followRedirect(next, depth + 1));
            }
            // Cualquier código 2xx (200, 203, 204...) significa que llegamos al destino
            resolve(url);
        });
        req.on('error', reject);
        req.setTimeout(15000, () => req.destroy(new Error('Timeout resolviendo URL')));
    });
}

function cleanTrackingParams(urlStr) {
    try {
        const u = new URL(urlStr);
        ['_r', '_t', 'is_from_webapp', 'sender_device', 'utm_source', 'utm_medium', 'fbclid', 'igshid', 'si'].forEach(p => u.searchParams.delete(p));
        return u.toString();
    } catch (_) {
        return urlStr;
    }
}

// Detecta si la URL es de TikTok (incluye enlaces cortos).
function isTiktokUrl(url) {
    return /https?:\/\/(www\.)?(vt|vm|v)\.tiktok\.com|tiktok\.com/i.test(url);
}

// Resuelve enlaces cortos de TikTok; para otras redes, limpia parámetros y devuelve.
async function resolveUrl(inputUrl) {
    const trimmed = (inputUrl || '').trim();
    if (!trimmed) return '';
    if (isTiktokUrl(trimmed) && /https?:\/\/(vt|vm)\.tiktok\.com/i.test(trimmed)) {
        try { return cleanTrackingParams(await followRedirect(trimmed)); }
        catch (_) { return cleanTrackingParams(trimmed); }
    }
    return cleanTrackingParams(trimmed);
}

// Ejecuta yt-dlp devolviendo { code, stdout, stderr }.
function runYtdlp(args) {
    return new Promise((resolve) => {
        execFile('yt-dlp', args, { maxBuffer: 1024 * 1024 * 50 }, (error, stdout, stderr) => {
            resolve({ code: error ? (error.code || 1) : 0, stdout: stdout || '', stderr: (stderr || '') + (error ? error.message : '') });
        });
    });
}

// Sanitiza un string para usarlo como nombre de archivo seguro.
function sanitizeFilename(str) {
    return (str || 'descarga').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').trim().substring(0, 200);
}

// Formatea segundos a mm:ss o h:mm:ss.
function formatDuration(secs) {
    if (!secs || secs <= 0) return null;
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
}

// Formatea bytes a formato legible.
function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return null;
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    let size = bytes;
    while (size >= 1024 && i < units.length - 1) { size /= 1024; i++; }
    return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

// Mapea el extractor de yt-dlp a un nombre de plataforma legible.
function getPlatformName(extractor) {
    const map = {
        'tiktok': 'TikTok',
        'youtube': 'YouTube',
        'instagram': 'Instagram',
        'facebook': 'Facebook',
        'twitter': 'X (Twitter)',
        'reddit': 'Reddit',
        'vimeo': 'Vimeo',
        'dailymotion': 'Dailymotion',
        'pinterest': 'Pinterest',
        'twitch': 'Twitch',
        'snapchat': 'Snapchat',
        'soundcloud': 'SoundCloud',
    };
    const key = (extractor || '').split(':')[0].toLowerCase();
    return map[key] || extractor || 'Desconocida';
}

// Extrae formatos de video únicos (incluye formatos DASH que son solo video;
// yt-dlp se encarga de muxear con audio automáticamente).
function extractVideoFormats(formats) {
    const seen = new Set();
    const result = [];
    for (const f of formats) {
        if (!f.vcodec || f.vcodec === 'none') continue;
        const height = f.height || 0;
        if (height <= 0) continue;

        const key = height;
        if (seen.has(key)) continue;
        seen.add(key);

        // Determinar si este formato ya tiene audio incluido
        const tieneAudio = f.acodec && f.acodec !== 'none';
        const ext = f.ext || 'mp4';
        const tamano = formatBytes(f.filesize || f.filesize_approx);
        const container = f.container || 'mp4';

        // Etiqueta legible: resolución, formato, tamaño aprox, y nota de mux si aplica
        const tamanoLabel = tamano ? '~' + tamano : '';
        const muxLabel = !tieneAudio ? '→ se agrega audio' : '';
        const etiqueta = `${height}p · ${ext.toUpperCase()}${tamanoLabel ? ' · ' + tamanoLabel : ''}${muxLabel ? ' · ' + muxLabel : ''}`;

        result.push({
            id: f.format_id,
            calidad: `${height}p`,
            etiqueta,
            extension: ext,
            tamano,
            contenedor: container,
            vcodec: f.vcodec,
            nota: f.format_note || '',
            tieneAudio,
        });
    }
    // Ordenar de menor a mayor resolución
    result.sort((a, b) => parseInt(a.calidad) - parseInt(b.calidad));
    return result;
}

// Extrae formatos de audio únicos.
function extractAudioFormats(formats) {
    const seen = new Set();
    const result = [];
    for (const f of formats) {
        if (!f.acodec || f.acodec === 'none') continue;
        // Queremos formatos que sean solo audio (sin video)
        if (f.vcodec && f.vcodec !== 'none') continue;
        const br = f.tbr || f.abr || 0;
        const ext = f.ext || 'mp3';
        const tamano = formatBytes(f.filesize || f.filesize_approx);
        // Clave para deduplicar: combinación de bitrate + extensión
        const key = `${Math.round(br)}_${ext}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const etiqueta = `${ext.toUpperCase()}${br > 0 ? ' · ' + Math.round(br) + 'kbps' : ''}${tamano ? ' · ~' + tamano : ''}`;
        result.push({
            id: f.format_id,
            calidad: f.format_note || (br > 0 ? `${Math.round(br)}kbps` : 'Audio'),
            etiqueta,
            extension: ext,
            tamano,
            contenedor: f.container || ext,
            acodec: f.acodec,
            bitrate: br,
        });
    }
    // Ordenar por bitrate ascendente
    result.sort((a, b) => (a.bitrate || 0) - (b.bitrate || 0));
    return result;
}

// =======================================================================
// RUTAS DE LA API
// =======================================================================

// Analiza un enlace: detecta la plataforma y extrae formatos disponibles.
app.post('/api/analyze', async (req, res) => {
    if (!req.body.url) return res.status(400).json({ error: "Falta la URL" });

    const safeUrl = await resolveUrl(req.body.url);
    if (!safeUrl) return res.status(400).json({ error: "URL vacía o inválida" });

    // Para TikTok, reescribimos /photo/ -> /video/ porque el extractor no acepta /photo/
    const ytdlpUrl = isTiktokUrl(safeUrl) ? safeUrl.replace('/photo/', '/video/') : safeUrl;

    const { code, stdout, stderr } = await runYtdlp(['--dump-json', '--no-warnings', ytdlpUrl]);
    if (code !== 0) {
        const detalle = stderr.split('\n').filter(l => l.trim())[0] || 'Error desconocido';
        return res.status(500).json({ error: "No se pudo analizar el enlace.", detalle });
    }

    try {
        const m = JSON.parse(stdout);
        const fmts = m.formats || [];
        const tieneVideo = fmts.some(f => f.vcodec && f.vcodec !== 'none');
        const tieneAudio = fmts.some(f => f.acodec && f.acodec !== 'none');

        // Detección de carrusel (TikTok): tiene audio pero no video
        const esCarrusel = isTiktokUrl(safeUrl) && !tieneVideo && tieneAudio;
        // Detección de contenido solo audio
        const esAudio = !tieneVideo && tieneAudio;

        const plataformas = getPlatformName(m.extractor_key || m.extractor);

        res.json({
            titulo: m.title || m.description || 'Publicación',
            autor: m.uploader ? ('@' + m.uploader) : (m.uploader_id || 'Desconocido'),
            duracion: formatDuration(m.duration),
            thumbnail: m.thumbnail || null,
            plataforma: plataformas,
            esCarrusel,
            esAudio,
            puedeVideo: tieneVideo,
            puedeAudio: tieneAudio,
            formatos_video: extractVideoFormats(fmts),
            formatos_audio: extractAudioFormats(fmts),
        });
    } catch (e) {
        res.status(500).json({ error: "Datos ilegibles recibidos de la red social." });
    }
});

// Descarga un archivo (video o audio) según el formato seleccionado.
// Estrategia: descarga a archivo temporal en /tmp, luego lo envía como stream
// al navegador. Esto permite que yt-dlp haga mux (video + audio) y conversión
// de formato correctamente, algo imposible con pipe a stdout (-o -).
app.get('/api/download', async (req, res) => {
    const safeUrl = await resolveUrl(req.query.url);
    if (!safeUrl) return res.status(400).send("Falta la URL");

    const formatId = req.query.formatId || 'best';
    const tipo = req.query.tipo || 'video';
    const titulo = sanitizeFilename(req.query.titulo || 'descarga');
    const reqExt = req.query.ext || '';

    const ytdlpUrl = isTiktokUrl(safeUrl) ? safeUrl.replace('/photo/', '/video/') : safeUrl;

    // Determinar si se necesita mux (combinar video + audio por separado)
    // Esto ocurre cuando se pide un formato DASH de solo video
    const necesitaMux = tipo === 'video' && formatId !== 'best';

    // Construir argumentos de formato para yt-dlp
    let formatArg;
    if (formatId === 'best') {
        // Mejor calidad: preferir MP4 pre-combinado, sino combinamos
        formatArg = tipo === 'audio' ? 'bestaudio[ext=m4a]/bestaudio/best' : 'bv*[ext=mp4]+ba[ext=m4a]/bv+ba/b[ext=mp4]/bv+ba/b';
    } else if (necesitaMux) {
        // Formato específico de solo video: combinar con mejor audio
        formatArg = `${formatId}+ba/b[ext=mp4]/b`;
    } else {
        formatArg = formatId;
    }

    // Archivo temporal único para esta descarga
    const tmpId = Date.now() + '_' + Math.random().toString(36).substring(2, 8);
    const tmpDir = require('os').tmpdir();
    const tmpFile = path.join(tmpDir, `descargador_${tmpId}.mp4`);

    const args = [
        '-f', formatArg,
        '--merge-output-format', 'mp4',
        '-o', tmpFile,
        '--no-warnings',
        '--no-mtime',
        ytdlpUrl,
    ];

    try {
        // Ejecutar yt-dlp y esperar a que termine
        await new Promise((resolve, reject) => {
            const ytdlp = spawn('yt-dlp', args);
            let stderrData = '';
            ytdlp.stderr.on('data', d => { stderrData += d.toString(); });
            ytdlp.on('close', code => {
                if (code === 0) return resolve();
                reject(new Error(stderrData.split('\n').filter(l => l.trim()).pop() || 'Error descargando'));
            });
            ytdlp.on('error', reject);
        });

        // Verificar que el archivo existe y tiene contenido
        const fs = require('fs');
        const stat = fs.statSync(tmpFile);
        if (!stat || stat.size === 0) {
            return res.status(500).send("El archivo descargado está vacío.");
        }

        // Enviar el archivo al navegador
        const mimeTypes = {
            'mp4': 'video/mp4',
            'webm': 'video/webm',
            'mkv': 'video/x-matroska',
            'mp3': 'audio/mpeg',
            'm4a': 'audio/mp4',
            'opus': 'audio/ogg',
            'ogg': 'audio/ogg',
            'flac': 'audio/flac',
            'wav': 'audio/wav',
        };

        let ext = reqExt || (tipo === 'audio' ? 'mp3' : 'mp4');
        const contentType = mimeTypes[ext] || (tipo === 'audio' ? 'audio/mpeg' : 'video/mp4');
        const filename = `${titulo}.${ext}`;

        res.header('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
        res.header('Content-Type', contentType);
        res.header('Content-Length', stat.size);

        const readStream = fs.createReadStream(tmpFile);
        readStream.pipe(res);

        // Limpiar el archivo temporal después de enviarlo
        readStream.on('end', () => {
            try { fs.unlinkSync(tmpFile); } catch (_) {}
        });
        readStream.on('error', () => {
            try { fs.unlinkSync(tmpFile); } catch (_) {}
            if (!res.headersSent) res.status(500).send("Error enviando el archivo.");
        });
    } catch (err) {
        // Limpiar archivo temporal si algo salió mal
        try { require('fs').unlinkSync(tmpFile); } catch (_) {}
        if (!res.headersSent) {
            res.status(500).send(err.message || "No se pudo descargar el archivo.");
        }
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`Servidor activo en el puerto ${PORT}`));
