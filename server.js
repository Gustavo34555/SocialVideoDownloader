const express = require('express');
const cors = require('cors');
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const fsPromises = require('fs').promises;
const os = require('os');
const https = require('https');
const http = require('http');
const path = require('path');
const net = require('net');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.set('trust proxy', 1);

const BLOCKED_STATIC = new Set([
    'server.js', 'package.json', 'package-lock.json',
    'Dockerfile', '.dockerignore', '.gitignore', 'README.md',
    'cookies.txt'
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

const COOKIES_PATH = path.join(os.tmpdir(), 'yt_cookies.txt');
let hasCookies = false;

if (process.env.YOUTUBE_COOKIES) {
    const cookieContent = process.env.YOUTUBE_COOKIES.trim();
    fs.writeFileSync(COOKIES_PATH, cookieContent);
    hasCookies = true;
    console.log(`[SISTEMA] Cookies OK desde YOUTUBE_COOKIES (${cookieContent.split('\n').length} lineas)`);
} else if (fs.existsSync('cookies.txt')) {
    fs.copyFileSync('cookies.txt', COOKIES_PATH);
    hasCookies = true;
    console.log('[SISTEMA] Cookies OK desde cookies.txt');
} else {
    console.log('[SISTEMA] Sin cookies - usando Invidious como proxy para YouTube');
}

// ==========================================
// INSTANCIAS INVIDIOUS (fallback para YouTube)
// ==========================================
const INVIDIOUS_INSTANCES = [
    'https://vid.puffyan.us',
    'https://invidious.fdn.fr',
    'https://yewtu.be',
    'https://inv.nadeko.net',
    'https://invidious.privacyredirect.com'
];

// ==========================================
// RATE LIMITING
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

function extractYoutubeId(url) {
    try {
        const u = new URL(url);
        if (u.hostname === 'youtu.be') return u.pathname.slice(1).split('/')[0];
        if (u.searchParams.has('v')) return u.searchParams.get('v');
        const match = u.pathname.match(/\/(embed|v|shorts)\/([^/?]+)/);
        if (match) return match[2];
    } catch (_) {}
    return null;
}

function getYoutubeArgs() {
    return [
        '--extractor-args', 'youtube:player_client=tv_downgraded,web,android_vr',
        '--js-runtimes', 'node',
        '--remote-components', 'ejs:github',
        '--force-ipv4',
        '--retries', '3',
        '--fragment-retries', '3'
    ];
}

// ==========================================
// INVIDIOUS API (fallback YouTube)
// ==========================================
function httpGet(url, timeout = 15000) {
    return new Promise((resolve, reject) => {
        const proto = url.startsWith('https') ? https : http;
        const req = proto.get(url, { headers: { 'User-Agent': USER_AGENT } }, response => {
            let data = '';
            response.on('data', chunk => data += chunk);
            response.on('end', () => {
                if (response.statusCode >= 200 && response.statusCode < 300) {
                    resolve(data);
                } else {
                    reject(new Error(`HTTP ${response.statusCode}`));
                }
            });
        });
        req.on('error', reject);
        req.setTimeout(timeout, () => req.destroy(new Error('Timeout')));
    });
}

async function fetchInvidiousInfo(videoId) {
    for (const instance of INVIDIOUS_INSTANCES) {
        try {
            const url = `${instance}/api/v1/videos/${videoId}`;
            const raw = await httpGet(url, 10000);
            const data = JSON.parse(raw);
            if (data.error) continue;

            const formatStreams = (data.format_streams || []).map(f => ({
                url: f.url,
                quality: f.qualityLabel || `${f.resolution}p`,
                resolution: parseInt(f.resolution) || 0,
                container: f.container || 'mp4',
                type: f.type || '',
                audio: true
            }));

            const adaptive = (data.adaptive_formats || []).map(f => ({
                url: f.url,
                quality: f.qualityLabel || `${f.resolution || ''}p`,
                resolution: parseInt(f.resolution) || 0,
                container: f.container || 'mp4',
                type: f.type || '',
                audio: (f.type || '').startsWith('audio')
            }));

            return {
                titulo: data.title || 'Video de YouTube',
                thumbnail: data.videoThumbnails?.find(t => t.quality === 'maxresdefault')?.url
                    || data.videoThumbnails?.find(t => t.quality === 'high')?.url
                    || null,
                platform: 'YouTube (Invidious)',
                streams: formatStreams,
                adaptive: adaptive
            };
        } catch (_) { continue; }
    }
    return null;
}

// ==========================================
// UTILIDADES
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

function isAllowedStreamUrl(urlStr) {
    try {
        const u = new URL(urlStr);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
        const host = u.hostname.toLowerCase();
        if (host === 'localhost' || host.endsWith('.local')) return false;
        if (net.isIP(host)) return false;
        const invidiousHosts = INVIDIOUS_INSTANCES.map(i => new URL(i).hostname.toLowerCase());
        if (invidiousHosts.includes(host)) return true;
        if (host === 'googlevideo.com' || host.endsWith('.googlevideo.com')) return true;
        return false;
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
// ENDPOINT DE SALUD
// ==========================================
app.get('/health', (req, res) => res.status(200).json({ status: 'ok' }));

// ==========================================
// ANALYZE - yt-dlp con fallback Invidious para YouTube
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

    // Para YouTube: intentar Invidious primero (sin dependencia de cookies)
    if (isYoutube(targetUrl) && !hasCookies) {
        const videoId = extractYoutubeId(targetUrl);
        if (videoId) {
            console.log(`[YOUTUBE] Intentando Invidious para ${videoId}...`);
            const info = await fetchInvidiousInfo(videoId);
            if (info) {
                console.log(`[YOUTUBE] Invidious OK: ${info.titulo}`);
                const videos = info.streams.filter(s => s.audio).map(s => ({
                    id: s.url,
                    calidad: s.quality,
                    ext: s.container,
                    tieneAudio: s.audio
                }));
                const audios = info.adaptive.filter(s => s.audio).map(s => ({
                    id: s.url,
                    calidad: s.quality,
                    ext: s.container
                }));
                return res.json({
                    titulo: info.titulo,
                    plataforma: info.platform,
                    platform: 'youtube',
                    thumbnail: info.thumbnail,
                    puedeVideo: videos.length > 0,
                    puedeAudio: audios.length > 0,
                    formatos: { videos, audios },
                    invidious: true
                });
            }
            console.log('[YOUTUBE] Invidious fallo, intentando yt-dlp...');
        }
    }

    // Fallback: yt-dlp
    const args = ['--dump-json', '--no-warnings'];
    if (hasCookies) args.push('--cookies', COOKIES_PATH);
    if (isYoutube(targetUrl)) {
        args.push(...getYoutubeArgs());
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

// ==========================================
// DOWNLOAD - con soporte Invidious para YouTube
// ==========================================
app.get('/api/download', rateLimit, async (req, res) => {
    let targetUrl;
    try {
        targetUrl = await prepareUrl(req.query.url);
    } catch (e) {
        return res.status(400).json({ error: e.message || 'URL no valida.' });
    }

    const { formatId = 'best', tipo = 'video' } = req.query;

    // Si el formatId es una URL de Invidious, descargar directamente
    if (isAllowedStreamUrl(formatId)) {
        const tmpFile = path.join(os.tmpdir(), `dl_${Date.now()}_${Math.random().toString(36).slice(2)}.mp4`);
        try {
            const proto = formatId.startsWith('https') ? https : http;
            await new Promise((resolve, reject) => {
                const req2 = proto.get(formatId, {
                    headers: { 'User-Agent': USER_AGENT, 'Referer': 'https://invidious.io/' }
                }, response => pipeToFile(response, tmpFile, res, tipo, resolve, reject));
                req2.on('error', reject);
                req2.setTimeout(60000, () => req2.destroy(new Error('Timeout')));
            });
        } catch (e) {
            console.error('[DOWNLOAD] Error:', e.message);
            if (!res.headersSent) res.status(500).send('Error al descargar desde Invidious.');
        }
        return;
    }

    // Fallback: yt-dlp
    const isAudio = tipo === 'audio';
    const baseFile = path.join(os.tmpdir(), `dl_${Date.now()}_${Math.random().toString(36).slice(2)}`);
    const tmpFile = isAudio ? `${baseFile}.%(ext)s` : `${baseFile}.mp4`;

    let formatArg = formatId === 'best'
        ? (isAudio ? 'bestaudio/best' : 'bestvideo+bestaudio/best')
        : (isAudio ? formatId : `${formatId}+bestaudio/best`);

    const args = ['-o', tmpFile, '--no-warnings'];
    if (isAudio) {
        args.push('-x', '--audio-format', 'mp3', '--audio-quality', '0');
    } else {
        args.push('--merge-output-format', 'mp4');
    }
    args.push('-f', formatArg);
    if (hasCookies) args.push('--cookies', COOKIES_PATH);
    if (isYoutube(targetUrl)) {
        args.push(...getYoutubeArgs());
    }
    args.push(targetUrl);

    const ytdlp = spawn('yt-dlp', args);
    let tmpCleaned = false;
    let resolvedFile = null;

    const cleanTmp = async () => {
        if (tmpCleaned) return;
        tmpCleaned = true;
        if (resolvedFile) {
            try { await fsPromises.unlink(resolvedFile); } catch (_) {}
        }
    };

    res.on('close', () => {
        if (!resolvedFile) ytdlp.kill('SIGKILL');
    });

    ytdlp.on('error', async () => {
        await cleanTmp();
        if (!res.headersSent) res.status(500).send('Error al iniciar la descarga.');
    });

    ytdlp.on('close', async code => {
        if (code !== 0) {
            await cleanTmp();
            if (!res.headersSent) return res.status(500).send('Error en la descarga interna de yt-dlp.');
            return;
        }

        try {
            if (isAudio) {
                const dir = os.tmpdir();
                const files = await fsPromises.readdir(dir);
                const name = path.basename(baseFile);
                const match = files.filter(f => f.startsWith(name + '.')).sort().pop();
                resolvedFile = match ? path.join(dir, match) : null;
            } else if (fs.existsSync(`${baseFile}.mp4`)) {
                resolvedFile = `${baseFile}.mp4`;
            }

            if (!resolvedFile) {
                await cleanTmp();
                if (!res.headersSent) return res.status(500).send('Error en la descarga interna de yt-dlp.');
                return;
            }

            const stat = await fsPromises.stat(resolvedFile);
            const finalExt = isAudio ? 'mp3' : 'mp4';
            const contentType = isAudio ? 'audio/mpeg' : 'video/mp4';

            res.setHeader('Content-Disposition', `attachment; filename="Descarga_${Date.now()}.${finalExt}"`);
            res.setHeader('Content-Type', contentType);
            res.setHeader('Content-Length', stat.size);

            const stream = fs.createReadStream(resolvedFile);
            stream.pipe(res);
            stream.on('close', () => cleanTmp());
            stream.on('error', () => cleanTmp());
        } catch (e) {
            await cleanTmp();
            if (!res.headersSent) res.status(500).send('Error al enviar el archivo.');
        }
    });
});

function pipeToFile(response, tmpFile, res, tipo, resolve, reject) {
    if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        const loc = response.headers.location;
        if (!isAllowedStreamUrl(loc)) {
            response.resume();
            return reject(new Error('Redirect no permitido'));
        }
        const proto = loc.startsWith('https') ? https : http;
        proto.get(loc, { headers: { 'User-Agent': USER_AGENT } }, r => pipeToFile(r, tmpFile, res, tipo, resolve, reject)).on('error', reject);
        return;
    }
    if (response.statusCode !== 200) {
        response.resume();
        return reject(new Error(`HTTP ${response.statusCode}`));
    }
    const fileStream = fs.createWriteStream(tmpFile);
    response.pipe(fileStream);
    fileStream.on('finish', async () => {
        try {
            const stat = await fsPromises.stat(tmpFile);
            const finalExt = tipo === 'audio' ? 'mp3' : 'mp4';
            const contentType = tipo === 'audio' ? 'audio/mpeg' : 'video/mp4';
            res.setHeader('Content-Disposition', `attachment; filename="Descarga_${Date.now()}.${finalExt}"`);
            res.setHeader('Content-Type', contentType);
            res.setHeader('Content-Length', stat.size);
            const readStream = fs.createReadStream(tmpFile);
            readStream.pipe(res);
            readStream.on('close', () => fsPromises.unlink(tmpFile).catch(() => {}));
            resolve();
        } catch (e) {
            fsPromises.unlink(tmpFile).catch(() => {});
            reject(e);
        }
    });
    fileStream.on('error', e => { fsPromises.unlink(tmpFile).catch(() => {}); reject(e); });
}

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
