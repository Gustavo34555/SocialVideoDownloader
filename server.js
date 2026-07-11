const express = require('express');
const cors = require('cors');
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const http = require('http');
const archiver = require('archiver');

const app = express();

/* ═══════════════════════════════════════════
   CONFIGURACIÓN
═══════════════════════════════════════════ */
const PORT = process.env.PORT || 3000;
const TMP_DIR = process.env.TMP_DIR || path.join(os.tmpdir(), 'ytdl');
const YTDLP = '/usr/local/bin/yt-dlp';
const COOKIES_DIR = path.join(__dirname, 'cookies');
const TOKENS_DIR = path.join(__dirname, 'tokens');

if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
if (!fs.existsSync(COOKIES_DIR)) fs.mkdirSync(COOKIES_DIR, { recursive: true });
if (!fs.existsSync(TOKENS_DIR)) fs.mkdirSync(TOKENS_DIR, { recursive: true });

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '.')));

/* ═══════════════════════════════════════════
   INVIDIOUS - INSTANCIAS ACTUALIZADAS 2026
═══════════════════════════════════════════ */
const INVIDIOUS_INSTANCES = [
    'https://inv.nadeko.net',
    'https://invidious.nerdvpn.de',
    'https://iv.nboeck.de',
    'https://yt.artemislena.eu',
    'https://iv.datura.network',
    'https://iv.nboeck.de',
    'https://yt.drgnz.club',
    'https://iv.melmac.space'
];

/* ═══════════════════════════════════════════
   UTILIDADES HTTP
═══════════════════════════════════════════ */
function httpGet(url, options = {}) {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https:') ? https : http;
        const req = client.get(url, {
            headers: { 
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
                'Accept-Encoding': 'gzip, deflate, br',
                'DNT': '1',
                'Connection': 'keep-alive',
                ...options.headers
            },
            timeout: options.timeout || 15000,
            maxRedirects: options.maxRedirects || 5
        }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                return resolve({ redirect: res.headers.location, statusCode: res.statusCode });
            }
            if (res.statusCode !== 200) {
                res.resume();
                return reject(new Error(`HTTP ${res.statusCode}`));
            }
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve({ data, statusCode: res.statusCode, headers: res.headers }));
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    });
}

function httpGetJson(url, timeout = 15000) {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https:') ? https : http;
        const req = client.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
            timeout
        }, (res) => {
            if (res.statusCode !== 200) {
                res.resume();
                return reject(new Error(`HTTP ${res.statusCode}`));
            }
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data)); }
                catch (e) { reject(new Error('JSON inválido')); }
            });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Timeout')); });
    });
}

function downloadFile(url, dest, timeout = 300000) {
    return new Promise((resolve, reject) => {
        const client = url.startsWith('https:') ? https : http;
        const file = fs.createWriteStream(dest);
        const req = client.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
            timeout
        }, (res) => {
            if (res.statusCode !== 200) {
                file.destroy();
                res.resume();
                return reject(new Error(`HTTP ${res.statusCode}`));
            }
            res.pipe(file);
            file.on('finish', () => { file.close(); resolve(dest); });
        });
        req.on('error', (err) => { file.destroy(); fs.unlink(dest, ()=>{}); reject(err); });
        req.on('timeout', () => { req.destroy(); file.destroy(); fs.unlink(dest, ()=>{}); reject(new Error('Timeout')); });
    });
}

function runYtDlp(args, timeout = 300000) {
    return new Promise((resolve, reject) => {
        const proc = spawn(YTDLP, args, { env: { ...process.env, PYTHONUNBUFFERED: '1' } });
        let stderr = '', stdout = '';
        proc.stderr.on('data', d => stderr += d.toString());
        proc.stdout.on('data', d => stdout += d.toString());

        const t = setTimeout(() => {
            proc.kill('SIGTERM');
            setTimeout(() => { try { proc.kill('SIGKILL'); } catch(_) {} }, 5000);
            reject(new Error('Timeout: la operación tardó demasiado'));
        }, timeout);

        proc.on('close', code => {
            clearTimeout(t);
            if (code === 0) return resolve(stdout);
            const errLine = stderr.split('\n').filter(l => l.trim() && !l.startsWith('[')).pop()
                || stderr.split('\n').filter(l => l.trim()).pop()
                || `Exit code ${code}`;
            reject(new Error(errLine));
        });
        proc.on('error', err => { clearTimeout(t); reject(err); });
    });
}

/* ═══════════════════════════════════════════
   UTILIDADES
═══════════════════════════════════════════ */
const sanitize = (s) => (s || 'download').replace(/[<>:"\/\\|?*\x00-\x1f]/g, '_').substring(0, 120);

function detectPlatform(url) {
    const map = [
        ['youtube', /(?:youtube\.com|youtu\.be)/i],
        ['tiktok', /tiktok\.com|vt\.tiktok\.com|vm\.tiktok\.com/i],
        ['instagram', /instagram\.com/i],
        ['facebook', /facebook\.com|fb\.watch/i],
        ['twitter', /twitter\.com|x\.com/i],
        ['reddit', /reddit\.com/i],
        ['twitch', /twitch\.tv/i],
        ['vimeo', /vimeo\.com/i],
        ['soundcloud', /soundcloud\.com/i],
    ];
    for (const [name, re] of map) if (re.test(url)) return name;
    return 'unknown';
}

function isTikTokPhoto(url) {
    return /tiktok\.com\/.*\/photo\//i.test(url);
}

function isTikTokShortUrl(url) {
    return /^(https?:\/\/)?(vt|vm)\.tiktok\.com\//i.test(url);
}

function extractYouTubeId(url) {
    const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/)([a-zA-Z0-9_-]{11})/);
    return m ? m[1] : null;
}

function cleanup(basePath) {
    const exts = ['', '.mp4', '.webm', '.mkv', '.mp3', '.m4a', '.opus', '.ogg', '.flac', '.wav', '.part', '.ytdl', '.zip', '.jpg', '.jpeg', '.png', '.m4v', '.avi'];
    exts.forEach(ext => { try { fs.unlinkSync(basePath + ext); } catch (_) {} });
    try {
        const dir = basePath + '_slideshow';
        if (fs.existsSync(dir)) {
            fs.readdirSync(dir).forEach(f => fs.unlinkSync(path.join(dir, f)));
            fs.rmdirSync(dir);
        }
    } catch (_) {}
}

function getYouTubeTokens() {
    const tokens = {};
    try { tokens.po_token = fs.readFileSync(path.join(TOKENS_DIR, 'po_token.txt'), 'utf8').trim(); } catch (_) {}
    try { tokens.visitor_data = fs.readFileSync(path.join(TOKENS_DIR, 'visitor_data.txt'), 'utf8').trim(); } catch (_) {}
    return tokens;
}

/* ═══════════════════════════════════════════
   RESOLVER URL CORTA DE TIKTOK
═══════════════════════════════════════════ */
async function resolveTikTokUrl(url) {
    if (!isTikTokShortUrl(url)) return url;
    try {
        const result = await httpGet(url, { maxRedirects: 0 });
        if (result.redirect) {
            console.log(`[tiktok] URL corta resuelta: ${result.redirect}`);
            return result.redirect;
        }
    } catch (e) {
        console.warn('[tiktok] No se pudo resolver URL corta:', e.message);
    }
    return url;
}

/* ═══════════════════════════════════════════
   EXTRAER IMÁGENES DE TIKTOK SLIDESHOW
═══════════════════════════════════════════ */
async function extractTikTokSlideshowImages(url) {
    // Resolver URL corta si es necesario
    const resolvedUrl = await resolveTikTokUrl(url);

    // Obtener HTML de la página
    const { data: html } = await httpGet(resolvedUrl, { timeout: 20000 });

    // Extraer imágenes del HTML usando regex
    // TikTok embeds images in SSR HTML with data attributes
    const images = [];

    // Patrón 1: Imágenes en meta tags (Open Graph)
    const ogImageRegex = /<meta[^>]*property="og:image"[^>]*content="([^"]+)"/gi;
    let match;
    while ((match = ogImageRegex.exec(html)) !== null) {
        if (!images.includes(match[1])) images.push(match[1]);
    }

    // Patrón 2: Imágenes en el JSON de datos de la página
    const ssrDataMatch = html.match(/<script[^>]*id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/i);
    if (ssrDataMatch) {
        try {
            const jsonStr = ssrDataMatch[1].trim();
            const data = JSON.parse(jsonStr);
            // Navegar por la estructura para encontrar imageList
            const findImages = (obj) => {
                if (typeof obj !== 'object' || obj === null) return;
                if (obj.imageList && Array.isArray(obj.imageList)) {
                    obj.imageList.forEach(img => {
                        if (img.url && !images.includes(img.url)) images.push(img.url);
                        if (img.imageURL && !images.includes(img.imageURL)) images.push(img.imageURL);
                        if (img.imageUrl && !images.includes(img.imageUrl)) images.push(img.imageUrl);
                    });
                }
                if (obj.images && Array.isArray(obj.images)) {
                    obj.images.forEach(img => {
                        if (typeof img === 'string' && !images.includes(img)) images.push(img);
                        if (img.url && !images.includes(img.url)) images.push(img.url);
                    });
                }
                Object.values(obj).forEach(v => findImages(v));
            };
            findImages(data);
        } catch (e) { console.warn('[tiktok] Error parseando SSR data:', e.message); }
    }

    // Patrón 3: Buscar en el HTML raw por URLs de imágenes de TikTok CDN
    const imgRegex = /https:\/\/[^"\s]+tiktokcdn\.com[^"\s]*\.(?:jpg|jpeg|png|webp)/gi;
    const cdnMatches = html.match(imgRegex) || [];
    cdnMatches.forEach(url => {
        if (!images.includes(url)) images.push(url);
    });

    // Patrón 4: Buscar en el script de inicialización
    const initDataMatch = html.match(/<script[^>]*>window\._SSR_HYDRATED_DATA\s*=\s*({[\s\S]*?});?<\/script>/i);
    if (initDataMatch) {
        try {
            const data = JSON.parse(initDataMatch[1]);
            const findImages = (obj) => {
                if (typeof obj !== 'object' || obj === null) return;
                if (obj.imageList && Array.isArray(obj.imageList)) {
                    obj.imageList.forEach(img => {
                        if (img.url && !images.includes(img.url)) images.push(img.url);
                    });
                }
                Object.values(obj).forEach(v => findImages(v));
            };
            findImages(data);
        } catch (e) {}
    }

    // Filtrar solo imágenes de alta calidad (no thumbnails pequeños)
    const highQualityImages = images.filter(url => 
        !url.includes('thumbnail') && 
        !url.includes('100x100') && 
        !url.includes('50x50') &&
        (url.includes('tos-maliva') || url.includes('tiktokcdn'))
    );

    return highQualityImages.length > 0 ? highQualityImages : images;
}

/* ═══════════════════════════════════════════
   EXTRAER AUDIO DE TIKTOK SLIDESHOW
═══════════════════════════════════════════ */
async function extractTikTokSlideshowAudio(url) {
    const resolvedUrl = await resolveTikTokUrl(url);
    const { data: html } = await httpGet(resolvedUrl, { timeout: 20000 });

    // Buscar URL de audio en el HTML
    const audioRegex = /https:\/\/[^"\s]+tiktokcdn\.com[^"\s]*\.(?:mp3|m4a|aac)/gi;
    const matches = html.match(audioRegex) || [];

    if (matches.length > 0) return matches[0];

    // Buscar en SSR data
    const ssrMatch = html.match(/<script[^>]*id="__UNIVERSAL_DATA_FOR_REHYDRATION__"[^>]*>([\s\S]*?)<\/script>/i);
    if (ssrMatch) {
        try {
            const data = JSON.parse(ssrMatch[1].trim());
            const findAudio = (obj) => {
                if (typeof obj !== 'object' || obj === null) return null;
                if (obj.music && obj.music.playUrl) return obj.music.playUrl;
                if (obj.audio && obj.audio.url) return obj.audio.url;
                if (obj.musicUrl) return obj.musicUrl;
                for (const v of Object.values(obj)) {
                    const found = findAudio(v);
                    if (found) return found;
                }
                return null;
            };
            const audioUrl = findAudio(data);
            if (audioUrl) return audioUrl;
        } catch (e) {}
    }

    return null;
}

/* ═══════════════════════════════════════════
   INVIDIOUS FALLBACK
═══════════════════════════════════════════ */
async function getInvidiousVideoInfo(videoId) {
    let lastErr = null;
    for (const instance of INVIDIOUS_INSTANCES) {
        try {
            const url = `${instance}/api/v1/videos/${videoId}?fields=title,videoId,lengthSeconds,author,authorId,formatStreams,adaptiveFormats,videoThumbnails`;
            const data = await httpGetJson(url, 10000);
            console.log(`[invidious] OK en ${instance}`);
            return { data, instance };
        } catch (e) {
            lastErr = e;
            console.warn(`[invidious] Falló ${instance}: ${e.message}`);
        }
    }
    throw lastErr || new Error('Ninguna instancia de Invidious respondió');
}

async function downloadFromInvidious(videoId, tipo, ext, basePath, title) {
    const { data, instance } = await getInvidiousVideoInfo(videoId);

    if (tipo === 'audio') {
        const audioFormats = (data.adaptiveFormats || []).filter(f => 
            f.type && f.type.startsWith('audio/') && f.url
        ).sort((a, b) => (parseInt(b.bitrate) || 0) - (parseInt(a.bitrate) || 0));

        if (audioFormats.length === 0) throw new Error('Invidious: no encontró streams de audio');

        const bestAudio = audioFormats[0];
        const rawAudio = basePath + '_raw';
        await downloadFile(bestAudio.url, rawAudio, 120000);

        const outFile = `${basePath}.${ext}`;
        await new Promise((resolve, reject) => {
            const ffmpeg = spawn('ffmpeg', [
                '-y', '-i', rawAudio,
                '-vn', '-c:a', ext === 'mp3' ? 'libmp3lame' : ext === 'opus' ? 'libopus' : 'aac',
                '-q:a', ext === 'mp3' ? '2' : '0',
                outFile
            ]);
            ffmpeg.on('close', code => {
                try { fs.unlinkSync(rawAudio); } catch (_) {}
                if (code === 0) resolve(); else reject(new Error(`ffmpeg exit ${code}`));
            });
            ffmpeg.on('error', reject);
        });

        return { file: outFile, title: data.title || title };
    } else {
        const formats = (data.formatStreams || []).filter(f => f.url);

        if (formats.length > 0) {
            const best = formats.reduce((a, b) => {
                const resA = parseInt(a.qualityLabel) || 0;
                const resB = parseInt(b.qualityLabel) || 0;
                return resB > resA ? b : a;
            });

            const outFile = `${basePath}.${ext}`;
            const rawFile = basePath + '_raw';
            await downloadFile(best.url, rawFile, 300000);

            const container = best.container || path.extname(best.url).slice(1) || 'mp4';
            if (container === ext || (container === 'mp4' && ext === 'mp4')) {
                fs.renameSync(rawFile, outFile);
            } else {
                await new Promise((resolve, reject) => {
                    const ffmpeg = spawn('ffmpeg', ['-y', '-i', rawFile, '-c', 'copy', outFile]);
                    ffmpeg.on('close', code => {
                        try { fs.unlinkSync(rawFile); } catch (_) {}
                        if (code === 0) resolve(); else reject(new Error(`ffmpeg exit ${code}`));
                    });
                    ffmpeg.on('error', reject);
                });
            }
            return { file: outFile, title: data.title || title };
        } else {
            const videoFormats = (data.adaptiveFormats || []).filter(f => 
                f.type && f.type.startsWith('video/') && f.url
            ).sort((a, b) => (parseInt(b.bitrate) || 0) - (parseInt(a.bitrate) || 0));
            const audioFormats = (data.adaptiveFormats || []).filter(f => 
                f.type && f.type.startsWith('audio/') && f.url
            ).sort((a, b) => (parseInt(b.bitrate) || 0) - (parseInt(a.bitrate) || 0));

            if (videoFormats.length === 0) throw new Error('Invidious: no encontró streams de video');

            const rawVideo = basePath + '_video';
            const rawAudio = basePath + '_audio';
            const outFile = `${basePath}.${ext}`;

            await downloadFile(videoFormats[0].url, rawVideo, 300000);
            if (audioFormats.length > 0) await downloadFile(audioFormats[0].url, rawAudio, 120000);

            await new Promise((resolve, reject) => {
                const args = ['-y', '-i', rawVideo];
                if (audioFormats.length > 0) args.push('-i', rawAudio);
                args.push('-c', 'copy', outFile);
                const ffmpeg = spawn('ffmpeg', args);
                ffmpeg.on('close', code => {
                    try { fs.unlinkSync(rawVideo); fs.unlinkSync(rawAudio); } catch (_) {}
                    if (code === 0) resolve(); else reject(new Error(`ffmpeg exit ${code}`));
                });
                ffmpeg.on('error', reject);
            });

            return { file: outFile, title: data.title || title };
        }
    }
}

/* ═══════════════════════════════════════════
   ESTRATEGIAS YT-DLP YOUTUBE
═══════════════════════════════════════════ */
function buildYouTubeStrategies(tipo, ext, basePath, url, cookiesFile) {
    const strategies = [];
    const hasCookies = fs.existsSync(cookiesFile) ? ['--cookies', cookiesFile] : [];
    const tokens = getYouTubeTokens();
    const tokenArgs = [];
    if (tokens.po_token && tokens.visitor_data) {
        tokenArgs.push('--extractor-args', `youtube:po_token=${tokens.po_token};visitor_data=${tokens.visitor_data}`);
    }
    const common = ['--no-warnings', '--no-check-certificates', '--geo-bypass', '--retries', '3', '--fragment-retries', '3'];

    // El extractor 'tv' es el más efectivo contra bot detection en datacenter
    const clients = ['tv', 'tv_downgraded', 'android_vr', 'web', 'mweb', 'ios'];
    clients.forEach(client => {
        const extractorArg = `--extractor-args youtube:player_client=${client}`;
        if (tipo === 'audio') {
            strategies.push([...common, ...hasCookies, ...tokenArgs, extractorArg, '-x', '--audio-format', ext, '--audio-quality', '0', '-o', basePath, url]);
        } else {
            const fmap = { mp4: 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best', webm: 'bestvideo[ext=webm]+bestaudio[ext=webm]/best[ext=webm]/best', mkv: 'bestvideo+bestaudio/best' };
            const sel = fmap[ext] || 'bestvideo+bestaudio/best';
            strategies.push([...common, ...hasCookies, ...tokenArgs, extractorArg, '-f', sel, '--merge-output-format', ext, '-o', basePath, url]);
        }
    });
    strategies.push([...common, ...hasCookies, ...tokenArgs, '--extractor-args', 'youtube:player_client=tv_downgraded', '-f', 'best[height<=1080]', '-o', basePath, url]);
    return strategies;
}

/* ═══════════════════════════════════════════
   TIKTOK SLIDESHOW HANDLER - NUEVO
═══════════════════════════════════════════ */
async function handleTikTokSlideshow(url, basePath, title, res) {
    const slideshowDir = basePath + '_slideshow';
    fs.mkdirSync(slideshowDir, { recursive: true });

    try {
        console.log('[tiktok-slideshow] Extrayendo imágenes...');
        const imageUrls = await extractTikTokSlideshowImages(url);
        console.log(`[tiktok-slideshow] ${imageUrls.length} imágenes encontradas`);

        if (imageUrls.length === 0) {
            throw new Error('No se encontraron imágenes en el slideshow. Verifica que la URL sea pública.');
        }

        // Descargar audio
        console.log('[tiktok-slideshow] Buscando audio...');
        let audioFile = null;
        try {
            const audioUrl = await extractTikTokSlideshowAudio(url);
            if (audioUrl) {
                audioFile = path.join(slideshowDir, 'audio.mp3');
                await downloadFile(audioUrl, audioFile, 60000);
                console.log('[tiktok-slideshow] Audio descargado');
            }
        } catch (e) { 
            console.warn('[tiktok-slideshow] No se pudo descargar audio:', e.message); 
        }

        // Descargar imágenes
        const downloadedImages = [];
        for (let i = 0; i < imageUrls.length; i++) {
            try {
                const ext = path.extname(new URL(imageUrls[i]).pathname).slice(1) || 'jpg';
                const imgPath = path.join(slideshowDir, `image_${String(i+1).padStart(2,'0')}.${ext}`);
                await downloadFile(imageUrls[i], imgPath, 30000);
                downloadedImages.push(imgPath);
                console.log(`[tiktok-slideshow] Imagen ${i+1}/${imageUrls.length} OK`);
            } catch (e) {
                console.warn(`[tiktok-slideshow] Falló imagen ${i+1}:`, e.message);
            }
        }

        if (downloadedImages.length === 0) {
            throw new Error('No se pudieron descargar las imágenes del slideshow');
        }

        // Crear ZIP
        const zipPath = basePath + '.zip';
        const output = fs.createWriteStream(zipPath);
        const archive = archiver('zip', { zlib: { level: 9 } });

        await new Promise((resolve, reject) => {
            output.on('close', resolve);
            archive.on('error', reject);
            archive.pipe(output);
            downloadedImages.forEach(img => archive.file(img, { name: path.basename(img) }));
            if (audioFile && fs.existsSync(audioFile)) archive.file(audioFile, { name: 'audio.mp3' });
            archive.finalize();
        });

        const stat = fs.statSync(zipPath);
        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(title)}_slideshow.zip"`);
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Length', stat.size);

        const stream = fs.createReadStream(zipPath);
        stream.pipe(res);
        stream.on('close', () => cleanup(basePath));
        stream.on('error', () => { cleanup(basePath); if (!res.headersSent) res.status(500).end(); });

    } catch (err) {
        cleanup(basePath);
        throw err;
    }
}

/* ═══════════════════════════════════════════
   ENDPOINTS
═══════════════════════════════════════════ */

app.get('/api/info', async (req, res) => {
    const { url } = req.query;
    if (!url || !/^https?:\/\/.+/.test(url)) return res.status(400).json({ error: 'URL inválida' });

    const platform = detectPlatform(url);
    const cookiesFile = path.join(COOKIES_DIR, 'cookies.txt');
    const hasCookies = fs.existsSync(cookiesFile) ? ['--cookies', cookiesFile] : [];
    const tokens = getYouTubeTokens();
    const tokenArgs = [];
    if (tokens.po_token && tokens.visitor_data) tokenArgs.push('--extractor-args', `youtube:po_token=${tokens.po_token};visitor_data=${tokens.visitor_data}`);

    // TikTok slideshow: obtener info directamente del HTML
    if (platform === 'tiktok' && (isTikTokPhoto(url) || isTikTokShortUrl(url))) {
        try {
            const resolvedUrl = await resolveTikTokUrl(url);
            const isPhoto = isTikTokPhoto(resolvedUrl);
            const { data: html } = await httpGet(resolvedUrl, { timeout: 15000 });

            // Extraer título
            const titleMatch = html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]+)"/i);
            const title = titleMatch ? titleMatch[1] : 'TikTok Slideshow';

            // Extraer thumbnail
            const thumbMatch = html.match(/<meta[^>]*property="og:image"[^>]*content="([^"]+)"/i);
            const thumbnail = thumbMatch ? thumbMatch[1] : '';

            // Extraer autor
            const authorMatch = html.match(/<meta[^>]*property="og:description"[^>]*content="([^"]+)"/i);
            const author = authorMatch ? authorMatch[1].split('·')[0].trim() : '';

            // Contar imágenes
            const imageUrls = await extractTikTokSlideshowImages(url);

            return res.json({
                title: sanitize(title),
                duration: 0,
                thumbnail,
                uploader: author,
                platform: 'tiktok',
                isSlideshow: isPhoto || imageUrls.length > 1,
                imageCount: imageUrls.length,
                hasCookies: fs.existsSync(cookiesFile),
                hasTokens: !!(tokens.po_token && tokens.visitor_data)
            });
        } catch (e) {
            console.error('[info] Error TikTok:', e.message);
        }
    }

    const infoStrategies = [];
    if (platform === 'youtube') {
        ['tv', 'tv_downgraded', 'android_vr', 'mweb'].forEach(client => {
            infoStrategies.push(['--dump-json', '--no-playlist', '--no-warnings', '--extractor-args', `youtube:player_client=${client}`, ...hasCookies, ...tokenArgs, url]);
        });
    } else {
        infoStrategies.push(['--dump-json', '--no-playlist', '--no-warnings', ...hasCookies, url]);
    }

    let lastErr = null;
    for (let i = 0; i < infoStrategies.length; i++) {
        try {
            console.log(`[info] ${platform} | strategy ${i + 1}/${infoStrategies.length}`);
            const out = await runYtDlp(infoStrategies[i], 30000);
            const d = JSON.parse(out);
            return res.json({
                title: d.title || 'Sin título', duration: d.duration, thumbnail: d.thumbnail,
                uploader: d.uploader, platform, isSlideshow: false,
                formats_count: d.formats ? d.formats.length : 0,
                description: d.description?.substring(0, 200),
                hasCookies: fs.existsSync(cookiesFile), hasTokens: !!(tokens.po_token && tokens.visitor_data)
            });
        } catch (e) { lastErr = e; }
    }

    // Fallback Invidious para YouTube
    if (platform === 'youtube') {
        const videoId = extractYouTubeId(url);
        if (videoId) {
            try {
                const { data } = await getInvidiousVideoInfo(videoId);
                return res.json({
                    title: data.title || 'Sin título', duration: data.lengthSeconds,
                    thumbnail: data.videoThumbnails?.[0]?.url || '', uploader: data.author,
                    platform: 'youtube', isSlideshow: false,
                    formats_count: (data.formatStreams?.length || 0) + (data.adaptiveFormats?.length || 0),
                    hasCookies: fs.existsSync(cookiesFile), hasTokens: !!(tokens.po_token && tokens.visitor_data),
                    source: 'invidious'
                });
            } catch (e) { console.warn('[info] Invidious fallback falló:', e.message); }
        }
    }

    res.status(500).json({ error: lastErr?.message || 'No se pudo obtener información', tip: 'YouTube bloquea IPs de datacenter. Prueba el modo Invidious.' });
});

app.post('/api/download', async (req, res) => {
    const { url, tipo = 'video', formato, mode = 'video' } = req.body;
    if (!url || !/^https?:\/\/.+/.test(url)) return res.status(400).json({ error: 'URL inválida' });

    const platform = detectPlatform(url);
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    const basePath = path.join(TMP_DIR, id);
    const cookiesFile = path.join(COOKIES_DIR, 'cookies.txt');
    let title = 'download';
    let usedInvidious = false;

    try {
        // TIKTOK SLIDESHOW
        if (platform === 'tiktok' && (isTikTokPhoto(url) || isTikTokShortUrl(url))) {
            const resolvedUrl = await resolveTikTokUrl(url);
            if (isTikTokPhoto(resolvedUrl) || mode === 'images') {
                // Obtener título del HTML
                try {
                    const { data: html } = await httpGet(resolvedUrl, { timeout: 10000 });
                    const titleMatch = html.match(/<meta[^>]*property="og:title"[^>]*content="([^"]+)"/i);
                    if (titleMatch) title = sanitize(titleMatch[1]);
                } catch (e) {}
                return await handleTikTokSlideshow(url, basePath, title, res);
            }
            // Si no es slideshow, continuar con yt-dlp normal
        }

        // Obtener título
        try {
            const infoArgs = ['--dump-json', '--no-playlist', '--no-warnings'];
            if (fs.existsSync(cookiesFile)) infoArgs.push('--cookies', cookiesFile);
            if (platform === 'youtube') {
                const tokens = getYouTubeTokens();
                if (tokens.po_token && tokens.visitor_data) infoArgs.push('--extractor-args', `youtube:po_token=${tokens.po_token};visitor_data=${tokens.visitor_data}`);
                infoArgs.push('--extractor-args', 'youtube:player_client=tv_downgraded');
            }
            const out = await runYtDlp([...infoArgs, url], 30000);
            title = sanitize(JSON.parse(out).title);
        } catch (e) { console.warn('[warn] Sin título:', e.message); }

        const ext = formato || (tipo === 'audio' ? 'mp3' : 'mp4');
        let strategies = [];

        if (platform === 'youtube') {
            strategies = buildYouTubeStrategies(tipo, ext, basePath, url, cookiesFile);
        } else if (platform === 'tiktok') {
            const common = ['--no-warnings', '--no-check-certificates', '--geo-bypass', '--retries', '3'];
            const hasCookies = fs.existsSync(cookiesFile) ? ['--cookies', cookiesFile] : [];
            if (tipo === 'audio') {
                strategies.push([...common, ...hasCookies, '-x', '--audio-format', ext, '--audio-quality', '0', '-o', basePath, url]);
            } else {
                strategies.push([...common, ...hasCookies, '-f', 'best', '--merge-output-format', ext, '-o', basePath, url]);
            }
            strategies.push([...common, ...hasCookies, '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', '-f', 'best', '-o', basePath, url]);
        } else {
            const common = ['--no-warnings', '--no-check-certificates', '--geo-bypass', '--retries', '3'];
            const hasCookies = fs.existsSync(cookiesFile) ? ['--cookies', cookiesFile] : [];
            if (tipo === 'audio') strategies.push([...common, ...hasCookies, '-x', '--audio-format', ext, '--audio-quality', '0', '-o', basePath, url]);
            else strategies.push([...common, ...hasCookies, '-f', 'best', '--merge-output-format', ext, '-o', basePath, url]);
            strategies.push([...common, ...hasCookies, '-f', 'best', '-o', basePath, url]);
        }

        // Ejecutar yt-dlp
        let finalFile = null, lastErr = null, isBotError = false;
        for (let i = 0; i < strategies.length; i++) {
            try {
                console.log(`[dl] ${platform} | strategy ${i + 1}/${strategies.length}`);
                await runYtDlp(strategies[i]);
                const candidates = [ext, 'mp4', 'webm', 'mkv', 'mp3', 'm4a', 'opus', 'ogg', 'flac', 'wav'].map(e => `${basePath}.${e}`);
                candidates.push(basePath);
                for (const f of candidates) if (fs.existsSync(f)) { finalFile = f; break; }
                if (!finalFile) throw new Error('Archivo no generado');
                lastErr = null; break;
            } catch (e) {
                console.error(`[dl] strategy ${i + 1} failed: ${e.message}`);
                lastErr = e;
                if (e.message.includes('bot') || e.message.includes('Sign in')) isBotError = true;
                cleanup(basePath);
                if (i < strategies.length - 1) await new Promise(r => setTimeout(r, 1500));
            }
        }

        // FALLBACK INVIDIOUS para YouTube
        if (!finalFile && platform === 'youtube' && isBotError) {
            const videoId = extractYouTubeId(url);
            if (videoId) {
                console.log(`[dl] Fallback a Invidious para ${videoId}`);
                try {
                    const result = await downloadFromInvidious(videoId, tipo, ext, basePath, title);
                    finalFile = result.file;
                    title = sanitize(result.title);
                    usedInvidious = true;
                    lastErr = null;
                } catch (e) {
                    console.error('[dl] Invidious fallback falló:', e.message);
                    lastErr = e;
                }
            }
        }

        if (lastErr) throw lastErr;
        if (!finalFile) throw new Error('No se generó el archivo');

        const stat = fs.statSync(finalFile);
        if (stat.size === 0) throw new Error('Archivo vacío');

        const mime = { mp4: 'video/mp4', webm: 'video/webm', mkv: 'video/x-matroska', mp3: 'audio/mpeg', m4a: 'audio/mp4', opus: 'audio/ogg', ogg: 'audio/ogg', flac: 'audio/flac', wav: 'audio/wav' };
        const outExt = path.extname(finalFile).slice(1) || ext;
        const filename = `${title}.${outExt}`;

        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
        res.setHeader('Content-Type', mime[outExt] || 'application/octet-stream');
        res.setHeader('Content-Length', stat.size);
        if (usedInvidious) res.setHeader('X-Source', 'invidious');

        const stream = fs.createReadStream(finalFile);
        stream.pipe(res);
        stream.on('close', () => cleanup(basePath));
        stream.on('error', () => { cleanup(basePath); if (!res.headersSent) res.status(500).end(); });

    } catch (err) {
        cleanup(basePath);
        console.error('[dl] Error:', err.message);
        if (!res.headersSent) {
            const tip = platform === 'youtube' && (err.message?.includes('bot') || err.message?.includes('Sign in'))
                ? 'YouTube bloquea IPs de datacenter. El servidor intentó Invidious. Si sigue fallando, ejecuta el servidor en local con tu IP de hogar.'
                : platform === 'tiktok' && (isTikTokPhoto(url) || isTikTokShortUrl(url))
                ? 'Verifica que la URL de TikTok sea pública y accesible sin login.'
                : null;
            res.status(500).json({ error: err.message || 'Error en descarga', tip });
        }
    }
});

app.post('/api/cookies', (req, res) => {
    const { content } = req.body;
    if (!content) return res.status(400).json({ error: 'Contenido vacío' });
    try { fs.writeFileSync(path.join(COOKIES_DIR, 'cookies.txt'), content); res.json({ ok: true }); }
    catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/tokens', (req, res) => {
    const { po_token, visitor_data } = req.body;
    if (!po_token || !visitor_data) return res.status(400).json({ error: 'Se requieren ambos tokens' });
    try {
        fs.writeFileSync(path.join(TOKENS_DIR, 'po_token.txt'), po_token.trim());
        fs.writeFileSync(path.join(TOKENS_DIR, 'visitor_data.txt'), visitor_data.trim());
        res.json({ ok: true, message: 'Tokens guardados' });
    } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/healthz', (req, res) => res.json({ ok: true, port: PORT, uptime: process.uptime() }));

app.get('/api/version', async (req, res) => {
    try { const v = await runYtDlp(['--version'], 10000); res.json({ yt_dlp: v.trim(), node: process.version }); }
    catch (e) { res.status(500).json({ error: 'No se pudo obtener versión' }); }
});

/* ═══════════════════════════════════════════
   STARTUP
═══════════════════════════════════════════ */
execFile(YTDLP, ['-U'], { timeout: 60000 }, () => {});
execFile(YTDLP, ['--version'], { timeout: 10000 }, (err, stdout) => {
    if (err) console.error('[startup] yt-dlp NO disponible:', err.message);
    else console.log('[startup] yt-dlp versión:', stdout.trim());
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`[startup] Puerto ${PORT}`);
    console.log(`[startup] TMP: ${TMP_DIR}`);
});