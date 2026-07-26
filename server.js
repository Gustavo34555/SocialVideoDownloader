const express = require('express');
const cors = require('cors');
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const fsPromises = require('fs').promises;
const os = require('os');
const https = require('https');
const http = require('http');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const BLOCKED_STATIC = new Set([
    'server.js', 'package.json', 'package-lock.json',
    'Dockerfile', '.dockerignore', '.gitignore', 'README.md'
]);

app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'no-referrer');
    next();
});

app.use((req, res, next) => {
    const filename = path.basename(req.path);
    if (BLOCKED_STATIC.has(filename)) return res.status(404).end();
    next();
});

app.use(express.static(__dirname));

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const hasCookies = fs.existsSync('cookies.txt');
console.log(`[SISTEMA] Archivo cookies.txt detectado: ${hasCookies ? 'SI' : 'NO'}`);

// ==========================================
// RATE LIMITING BASICO (en memoria)
// ==========================================
const RATE_WINDOW = 60000;
const RATE_MAX = 15;
const rateHits = new Map();

function rateLimit(req, res, next) {
    const ip = req.ip || req.connection.remoteAddress;
    const now = Date.now();
    const entry = rateHits.get(ip);
    if (!entry || now - entry.start > RATE_WINDOW) {
        rateHits.set(ip, { start: now, count: 1 });
        return next();
    }
    entry.count++;
    if (entry.count > RATE_MAX) return res.status(429).json({ error: 'Demasiadas peticiones. Espera un momento.' });
    next();
}

setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of rateHits) {
        if (now - entry.start > RATE_WINDOW * 2) rateHits.delete(ip);
    }
}, RATE_WINDOW * 2);

// ==========================================
// DETECCION DE PLATAFORMA
// ==========================================
function detectPlatform(url) {
    const u = url.toLowerCase();
    if (/youtube\.com|youtu\.be|m\.youtube\.com/i.test(u)) return 'youtube';
    if (/tiktok\.com|vt\.tiktok\.com|vm\.tiktok\.com/i.test(u)) return 'tiktok';
    if (/instagram\.com/i.test(u)) return 'instagram';
    if (/twitter\.com|x\.com/i.test(u)) return 'twitter';
    if (/facebook\.com|fb\.watch|web\.facebook\.com/i.test(u)) return 'facebook';
    if (/twitch\.tv/i.test(u)) return 'twitch';
    if (/soundcloud\.com/i.test(u)) return 'soundcloud';
    if (/vimeo\.com/i.test(u)) return 'vimeo';
    if (/reddit\.com/i.test(u)) return 'reddit';
    return 'otro';
}

function isYoutube(url) {
    return /youtube\.com|youtu\.be|m\.youtube\.com/i.test(url);
}

function getYoutubeExtractorArgs() {
    return 'youtube:player_client=web,android_vr,tv';
}

// ==========================================
// UTILIDADES Y RESOLUCION DE URL
// ==========================================
function followRedirect(url, depth = 0) {
    return new Promise((resolve, reject) => {
        if (depth > 10) return reject(new Error('Demasiados redirects'));
        const proto = url.startsWith('https') ? https : http;
        const req = proto.get(url, {
            headers: { 'User-Agent': USER_AGENT, 'Accept': '*/*' }
        }, response => {
            response.resume();
            if (response.statusCode && [301, 302, 303, 307, 308].includes(response.statusCode)) {
                const loc = response.headers.location;
                if (!loc) return reject(new Error('Redirect sin Location'));
                const next = loc.startsWith('http') ? loc : new URL(loc, url).toString();
                return resolve(followRedirect(next, depth + 1));
            }
            resolve(url);
        });
        req.on('error', reject);
        req.setTimeout(15000, () => req.destroy(new Error('Timeout')));
    });
}

function cleanUrl(urlStr) {
    try {
        const u = new URL(urlStr);
        ['_r', '_t', 'is_from_webapp', 'sender_device', 'si'].forEach(p => u.searchParams.delete(p));
        return u.toString();
    } catch (_) { return urlStr; }
}

function isValidUrl(str) {
    try {
        const u = new URL(str);
        return u.protocol === 'http:' || u.protocol === 'https:';
    } catch (_) { return false; }
}

async function prepareUrl(inputUrl) {
    let url = (inputUrl || '').trim();
    if (!isValidUrl(url)) throw new Error('URL no valida');
    if (/https?:\/\/(vt|vm)\.tiktok\.com/i.test(url)) {
        try { url = await followRedirect(url); } catch (_) {}
    }
    return cleanUrl(url).replace('/photo/', '/video/');
}

// ==========================================
// ENDPOINT DE SALUD (para Render)
// ==========================================
app.get('/health', (req, res) => res.status(200).json({ status: 'ok' }));

// ==========================================
// INTERACCIÓN CON YT-DLP
// ==========================================
app.post('/api/analyze', rateLimit, async (req, res) => {
    if (!req.body.url) return res.status(400).json({ error: 'Ingresa un enlace valido.' });

    let targetUrl;
    try {
        targetUrl = await prepareUrl(req.body.url);
    } catch (e) {
        return res.status(400).json({ error: e.message || 'URL no valida.' });
    }

    const platform = detectPlatform(targetUrl);

    const args = ['--dump-json', '--no-warnings'];
    if (hasCookies) args.push('--cookies', 'cookies.txt');
    if (isYoutube(targetUrl)) {
        args.push('--extractor-args', getYoutubeExtractorArgs());
        args.push('--force-ipv4');
    }
    args.push(targetUrl);

    execFile('yt-dlp', args, { maxBuffer: 1024 * 1024 * 10 }, (error, stdout, stderr) => {
        if (error) {
            console.error(stderr);
            return res.status(500).json({ error: 'Error al analizar. Revisa el enlace o intenta de nuevo.' });
        }
        try {
            const data = JSON.parse(stdout);
            const formats = data.formats || [];

            const videos = formats.filter(f => f.vcodec !== 'none' && f.height).map(f => ({
                id: f.format_id,
                calidad: `${f.height}p`,
                ext: f.ext || 'mp4',
                tieneAudio: f.acodec !== 'none'
            })).sort((a, b) => parseInt(b.calidad) - parseInt(a.calidad));

            const audios = formats.filter(f => f.acodec !== 'none' && f.vcodec === 'none').map(f => ({
                id: f.format_id,
                calidad: `${Math.round(f.abr || f.tbr || 0)} kbps`,
                ext: f.ext || 'm4a'
            })).sort((a, b) => parseInt(b.calidad) - parseInt(a.calidad));

            res.json({
                titulo: data.title || data.description || 'Archivo multimedia',
                plataforma: data.extractor_key || 'Desconocida',
                platform: platform,
                thumbnail: data.thumbnail || null,
                puedeVideo: videos.length > 0,
                puedeAudio: audios.length > 0,
                formatos: { videos, audios }
            });
        } catch (e) {
            res.status(500).json({ error: 'Datos de red social ilegibles.' });
        }
    });
});

app.get('/api/download', rateLimit, async (req, res) => {
    let targetUrl;
    try {
        targetUrl = await prepareUrl(req.query.url);
    } catch (e) {
        return res.status(400).json({ error: e.message || 'URL no valida.' });
    }

    const { formatId = 'best', tipo = 'video' } = req.query;
    const tmpFile = path.join(os.tmpdir(), `dl_${Date.now()}_${Math.random().toString(36).slice(2)}.mp4`);

    let formatArg = formatId === 'best'
        ? (tipo === 'audio' ? 'bestaudio/best' : 'bestvideo+bestaudio/best')
        : (tipo === 'video' ? `${formatId}+bestaudio/best` : formatId);

    const args = ['-f', formatArg, '--merge-output-format', 'mp4', '-o', tmpFile, '--no-warnings'];
    if (hasCookies) args.push('--cookies', 'cookies.txt');
    if (isYoutube(targetUrl)) {
        args.push('--extractor-args', getYoutubeExtractorArgs());
        args.push('--force-ipv4');
    }
    args.push(targetUrl);

    const ytdlp = spawn('yt-dlp', args);
    let tmpCleaned = false;

    const cleanTmp = async () => {
        if (tmpCleaned) return;
        tmpCleaned = true;
        try { await fsPromises.unlink(tmpFile); } catch (_) {}
    };

    ytdlp.on('error', async () => {
        await cleanTmp();
        if (!res.headersSent) res.status(500).send('Error al iniciar la descarga.');
    });

    ytdlp.on('close', async code => {
        if (code !== 0 || !fs.existsSync(tmpFile)) {
            await cleanTmp();
            if (!res.headersSent) return res.status(500).send('Error en la descarga interna de yt-dlp.');
            return;
        }

        try {
            const stat = await fsPromises.stat(tmpFile);
            const finalExt = tipo === 'audio' ? 'mp3' : 'mp4';
            const contentType = tipo === 'audio' ? 'audio/mpeg' : 'video/mp4';

            res.setHeader('Content-Disposition', `attachment; filename="Descarga_${Date.now()}.${finalExt}"`);
            res.setHeader('Content-Type', contentType);
            res.setHeader('Content-Length', stat.size);

            const stream = fs.createReadStream(tmpFile);
            stream.pipe(res);
            stream.on('close', () => cleanTmp());
            stream.on('error', () => cleanTmp());
        } catch (e) {
            await cleanTmp();
            if (!res.headersSent) res.status(500).send('Error al enviar el archivo.');
        }
    });
});

// ==========================================
// INICIO DEL SERVIDOR
// ==========================================
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, '0.0.0.0', () => console.log(`Servidor de Descargas activo -> Puerto ${PORT}`));

const gracefulShutdown = (signal) => {
    console.log(`\n[SISTEMA] ${signal} recibido. Cerrando servidor...`);
    server.close(() => {
        console.log('[SISTEMA] Servidor cerrado.');
        process.exit(0);
    });
    setTimeout(() => process.exit(1), 10000);
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('uncaughtException', (err) => {
    console.error('[SISTEMA] Excepcion no capturada:', err);
});
process.on('unhandledRejection', (reason) => {
    console.error('[SISTEMA] Promesa rechazada no manejada:', reason);
});
