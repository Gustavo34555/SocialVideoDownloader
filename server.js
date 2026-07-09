const express = require('express');
const cors = require('cors');
const { spawn, execFile } = require('child_process');
const https = require('https');
const http = require('http');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// =======================================================================
// RESOLUCIÓN DE URL
// Sigue los redirects HTTP manualmente hasta la URL canónica de TikTok y
// limpia los parámetros de seguimiento que confunden a los extractores.
// (Antes esto dependía de yt-dlp + --impersonate, que crasheaba sin curl_cffi.)
// =======================================================================

// GET que sigue redirects hasta la URL final (sin descargar el body).
function followRedirect(url, depth = 0) {
    return new Promise((resolve, reject) => {
        if (depth > 10) return reject(new Error('Demasiados redirects'));
        const proto = url.startsWith('https') ? https : http;
        const req = proto.get(url, {
            headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en-US,en;q=0.9' }
        }, response => {
            response.resume(); // liberar el socket
            if (response.statusCode && [301, 302, 303, 307, 308].includes(response.statusCode)) {
                const loc = response.headers.location;
                if (!loc) return reject(new Error('Redirect sin Location'));
                const next = loc.startsWith('http') ? loc : new URL(loc, url).toString();
                return resolve(followRedirect(next, depth + 1));
            }
            resolve(url); // sin redirect: URL canónica
        });
        req.on('error', reject);
        req.setTimeout(15000, () => req.destroy(new Error('Timeout resolviendo URL')));
    });
}

// Quita parámetros de seguimiento que rompen la extracción.
function cleanTrackingParams(urlStr) {
    try {
        const u = new URL(urlStr);
        ['_r', '_t', 'is_from_webapp', 'sender_device', 'utm_source', 'utm_medium'].forEach(p => u.searchParams.delete(p));
        return u.toString();
    } catch (_) {
        return urlStr;
    }
}

// Devuelve la URL canónica limpia (maneja enlaces cortos vt/vm y largos).
async function resolveTiktokUrl(inputUrl) {
    const trimmed = (inputUrl || '').trim();
    if (!trimmed) return '';
    if (/https?:\/\/(vt|vm)\.tiktok\.com/i.test(trimmed)) {
        try { return cleanTrackingParams(await followRedirect(trimmed)); }
        catch (_) { return cleanTrackingParams(trimmed); }
    }
    return cleanTrackingParams(trimmed);
}

// Ejecuta yt-dlp devolviendo { code, stdout, stderr } (sin --impersonate: crashea sin curl_cffi).
function runYtdlp(args) {
    return new Promise((resolve) => {
        execFile('yt-dlp', args, { maxBuffer: 1024 * 1024 * 50 }, (error, stdout, stderr) => {
            resolve({ code: error ? (error.code || 1) : 0, stdout: stdout || '', stderr: (stderr || '') + (error ? error.message : '') });
        });
    });
}

// =======================================================================
// RUTAS DE LA API
// =======================================================================

// Analiza un enlace: detecta si es video normal o carrusel de fotos.
// Para videos: yt-dlp da título/autor/formatos.
// Para carruseles: TikTok bloquea la extracción de imágenes, pero yt-dlp
// sí puede dar el audio y los metadatos. Se informa al cliente del tipo.
app.post('/api/analyze', async (req, res) => {
    if (!req.body.url) return res.status(400).json({ error: "Falta la URL" });

    const safeUrl = await resolveTiktokUrl(req.body.url);
    // Reescribimos /photo/ -> /video/ porque el extractor TikTok de yt-dlp
    // no acepta /photo/ (da Unsupported URL), pero la misma ID en /video/
    // sí resuelve los metadatos (incluido el audio del carrusel).
    const ytdlpUrl = safeUrl.replace('/photo/', '/video/');

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
        // Un carrusel detectado: TikTok sirve solo el audio (sin pistas de video).
        const esCarrusel = !tieneVideo && tieneAudio;
        res.json({
            titulo: m.title || m.description || "Publicación de TikTok",
            autor: m.uploader ? '@' + m.uploader : "Desconocido",
            esCarrusel,
            puedeAudio: tieneAudio
        });
    } catch (e) {
        res.status(500).json({ error: "Datos ilegibles recibidos de la red social." });
    }
});

// Descarga un video normal (stream directo al navegador).
app.get('/api/download-video', async (req, res) => {
    const safeUrl = await resolveTiktokUrl(req.query.url);
    if (!safeUrl) return res.status(400).send("Falta la URL");
    const ytdlpUrl = safeUrl.replace('/photo/', '/video/');

    res.header('Content-Disposition', 'attachment; filename="video_descargado.mp4"');
    res.header('Content-Type', 'video/mp4');

    const ytdlp = spawn('yt-dlp', ['-f', 'b[ext=mp4]/best', '-o', '-', '--no-warnings', ytdlpUrl]);
    ytdlp.stdout.pipe(res);
    ytdlp.stderr.on('data', () => {});
    ytdlp.on('close', code => {
        if (code !== 0 && !res.headersSent) res.status(500).send("No se pudo descargar el video.");
    });
});

// Descarga el audio de un carrusel (lo único que TikTok permite extraer).
app.get('/api/download-audio', async (req, res) => {
    const safeUrl = await resolveTiktokUrl(req.query.url);
    if (!safeUrl) return res.status(400).send("Falta la URL");
    const ytdlpUrl = safeUrl.replace('/photo/', '/video/');

    res.header('Content-Disposition', 'attachment; filename="audio_carrusel.mp3"');
    res.header('Content-Type', 'audio/mpeg');

    const ytdlp = spawn('yt-dlp', ['-f', 'bestaudio/best', '-o', '-', '--no-warnings', ytdlpUrl]);
    ytdlp.stdout.pipe(res);
    ytdlp.stderr.on('data', () => {});
    ytdlp.on('close', code => {
        if (code !== 0 && !res.headersSent) res.status(500).send("No se pudo descargar el audio.");
    });
});

app.listen(3000, () => console.log('Servidor activo en http://localhost:3000'));
