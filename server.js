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
   INVIDIOUS - INSTANCIAS Y UTILIDADES
═══════════════════════════════════════════ */
const INVIDIOUS_INSTANCES = [
    'https://inv.nadeko.net',
    'https://invidious.nerdvpn.de',
    'https://yt.chocolatemoo53.com',
    'https://invidious.tiekoetter.com',
    'https://invidious.f5.si',
    'https://inv.zoomerville.com'
];

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
            headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
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
        ['tiktok', /tiktok\.com/i],
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
        // Buscar mejor stream de audio en adaptiveFormats
        const audioFormats = (data.adaptiveFormats || []).filter(f => 
            f.type && f.type.startsWith('audio/') && f.url
        ).sort((a, b) => (parseInt(b.bitrate) || 0) - (parseInt(a.bitrate) || 0));

        if (audioFormats.length === 0) {
            throw new Error('Invidious: no encontró streams de audio');
        }

        const bestAudio = audioFormats[0];
        const rawAudio = basePath + '_raw';
        await downloadFile(bestAudio.url, rawAudio, 120000);

        // Convertir a formato deseado con ffmpeg
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
                if (code === 0) resolve();
                else reject(new Error(`ffmpeg exit ${code}`));
            });
            ffmpeg.on('error', reject);
        });

        return { file: outFile, title: data.title || title };
    } else {
        // Video: usar formatStreams (ya mergeados) o adaptiveFormats
        const formats = (data.formatStreams || []).filter(f => f.url);

        if (formats.length > 0) {
            // Usar formatStreams progresivo (ya tiene audio+video)
            const best = formats.reduce((a, b) => {
                const resA = parseInt(a.qualityLabel) || 0;
                const resB = parseInt(b.qualityLabel) || 0;
                return resB > resA ? b : a;
            });

            const outFile = `${basePath}.${ext}`;
            const rawFile = basePath + '_raw';
            await downloadFile(best.url, rawFile, 300000);

            // Si el formato no coincide, remuxear con ffmpeg
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
            // Adaptive formats: necesitamos mergear video+audio con ffmpeg
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
            if (audioFormats.length > 0) {
                await downloadFile(audioFormats[0].url, rawAudio, 120000);
            }

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
   ESTRATEGIAS YT-DLP
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

    ['tv', 'tv_downgraded', 'android_vr', 'web', 'mweb', 'ios'].forEach(client => {
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

function buildTikTokStrategies(tipo, ext, basePath, url, cookiesFile, mode = 'video') {
    const strategies = [];
    const hasCookies = fs.existsSync(cookiesFile) ? ['--cookies', cookiesFile] : [];
    const common = ['--no-warnings', '--no-check-certificates', '--geo-bypass', '--retries', '3'];

    if (isTikTokPhoto(url) && mode === 'audio') {
        const videoUrl = url.replace('/photo/', '/video/');
        strategies.push([...common, ...hasCookies, '-x', '--audio-format', ext, '--audio-quality', '0', '-o', basePath, videoUrl]);
        strategies.push([...common, ...hasCookies, '-f', 'bestaudio', '-x', '--audio-format', 'mp3', '-o', basePath, videoUrl]);
    } else {
        if (tipo === 'audio') {
            strategies.push([...common, ...hasCookies, '-x', '--audio-format', ext, '--audio-quality', '0', '-o', basePath, url]);
        } else {
            strategies.push([...common, ...hasCookies, '-f', 'best', '--merge-output-format', ext, '-o', basePath, url]);
        }
        strategies.push([...common, ...hasCookies, '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', '-f', 'best', '-o', basePath, url]);
    }
    return strategies;
}

/* ═══════════════════════════════════════════
   TIKTOK SLIDESHOW HANDLER
═══════════════════════════════════════════ */
async function handleTikTokSlideshow(url, basePath, title, res, cookiesFile) {
    const slideshowDir = basePath + '_slideshow';
    fs.mkdirSync(slideshowDir, { recursive: true });
    try {
        const videoUrl = url.replace('/photo/', '/video/');
        const infoArgs = ['--dump-json', '--no-warnings', '--no-playlist'];
        if (fs.existsSync(cookiesFile)) infoArgs.push('--cookies', cookiesFile);
        const out = await runYtDlp([...infoArgs, videoUrl], 30000);
        const data = JSON.parse(out);

        let imageUrls = [];
        if (data.thumbnails && data.thumbnails.length > 1) {
            imageUrls = data.thumbnails.filter(t => t.url && !t.url.includes('music')).map(t => t.url);
        }
        if (data.formats) {
            data.formats.forEach(f => {
                if (f.url && (f.ext === 'jpg' || f.ext === 'jpeg' || f.ext === 'png' || f.url.includes('.jpg'))) {
                    if (!imageUrls.includes(f.url)) imageUrls.push(f.url);
                }
            });
        }

        let audioFile = null;
        try {
            await runYtDlp([
                '--no-warnings', '--no-check-certificates',
                ...(fs.existsSync(cookiesFile) ? ['--cookies', cookiesFile] : []),
                '-x', '--audio-format', 'mp3', '--audio-quality', '0',
                '-o', path.join(slideshowDir, 'audio'),
                videoUrl
            ]);
            if (fs.existsSync(path.join(slideshowDir, 'audio.mp3'))) {
                audioFile = path.join(slideshowDir, 'audio.mp3');
            }
        } catch (e) { console.warn('[slideshow] No audio:', e.message); }

        const downloadedImages = [];
        for (let i = 0; i < imageUrls.length; i++) {
            try {
                const imgPath = path.join(slideshowDir, `image_${String(i+1).padStart(2,'0')}.jpg`);
                await downloadFile(imageUrls[i], imgPath);
                downloadedImages.push(imgPath);
            } catch (e) { console.warn(`[slideshow] Falló imagen ${i+1}:`, e.message); }
        }

        if (downloadedImages.length === 0) throw new Error('No se pudieron descargar las imágenes');

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
    } catch (err) { cleanup(basePath); throw err; }
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

    const infoStrategies = [];
    if (platform === 'youtube') {
        ['tv', 'tv_downgraded', 'android_vr', 'mweb'].forEach(client => {
            infoStrategies.push(['--dump-json', '--no-playlist', '--no-warnings', '--extractor-args', `youtube:player_client=${client}`, ...hasCookies, ...tokenArgs, url]);
        });
    } else if (platform === 'tiktok' && isTikTokPhoto(url)) {
        infoStrategies.push(['--dump-json', '--no-warnings', '--no-playlist', ...hasCookies, url.replace('/photo/', '/video/')]);
    } else {
        infoStrategies.push(['--dump-json', '--no-playlist', '--no-warnings', ...hasCookies, url]);
    }

    let lastErr = null;
    for (let i = 0; i < infoStrategies.length; i++) {
        try {
            console.log(`[info] ${platform} | strategy ${i + 1}/${infoStrategies.length}`);
            const out = await runYtDlp(infoStrategies[i], 30000);
            const d = JSON.parse(out);
            const isSlideshow = platform === 'tiktok' && isTikTokPhoto(url);
            return res.json({
                title: d.title || 'Sin título', duration: d.duration, thumbnail: d.thumbnail,
                uploader: d.uploader, platform, isSlideshow,
                formats_count: d.formats ? d.formats.length : 0,
                description: d.description?.substring(0, 200),
                hasCookies: fs.existsSync(cookiesFile), hasTokens: !!(tokens.po_token && tokens.visitor_data)
            });
        } catch (e) { lastErr = e; }
    }

    // Fallback a Invidious para YouTube si yt-dlp falla
    if (platform === 'youtube') {
        const videoId = extractYouTubeId(url);
        if (videoId) {
            try {
                const { data } = await getInvidiousVideoInfo(videoId);
                return res.json({
                    title: data.title || 'Sin título',
                    duration: data.lengthSeconds,
                    thumbnail: data.videoThumbnails?.[0]?.url || '',
                    uploader: data.author,
                    platform: 'youtube',
                    isSlideshow: false,
                    formats_count: (data.formatStreams?.length || 0) + (data.adaptiveFormats?.length || 0),
                    description: '',
                    hasCookies: fs.existsSync(cookiesFile),
                    hasTokens: !!(tokens.po_token && tokens.visitor_data),
                    source: 'invidious'
                });
            } catch (e) { console.warn('[info] Invidious fallback falló:', e.message); }
        }
    }

    res.status(500).json({ error: lastErr?.message || 'No se pudo obtener información', tip: 'YouTube bloquea IPs de datacenter. Prueba el fallback de Invidious o PO Token.' });
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
        // Obtener título
        try {
            const infoArgs = ['--dump-json', '--no-playlist', '--no-warnings'];
            if (fs.existsSync(cookiesFile)) infoArgs.push('--cookies', cookiesFile);
            if (platform === 'youtube') {
                const tokens = getYouTubeTokens();
                if (tokens.po_token && tokens.visitor_data) infoArgs.push('--extractor-args', `youtube:po_token=${tokens.po_token};visitor_data=${tokens.visitor_data}`);
                infoArgs.push('--extractor-args', 'youtube:player_client=tv_downgraded');
            }
            const targetUrl = (platform === 'tiktok' && isTikTokPhoto(url)) ? url.replace('/photo/', '/video/') : url;
            const out = await runYtDlp([...infoArgs, targetUrl], 30000);
            title = sanitize(JSON.parse(out).title);
        } catch (e) { console.warn('[warn] Sin título:', e.message); }

        // TikTok Photo modo imágenes
        if (platform === 'tiktok' && isTikTokPhoto(url) && mode === 'images') {
            return await handleTikTokSlideshow(url, basePath, title, res, cookiesFile);
        }

        const ext = formato || (tipo === 'audio' ? 'mp3' : 'mp4');
        let strategies = [];

        if (platform === 'youtube') {
            strategies = buildYouTubeStrategies(tipo, ext, basePath, url, cookiesFile);
        } else if (platform === 'tiktok') {
            strategies = buildTikTokStrategies(tipo, ext, basePath, url, cookiesFile, mode);
        } else {
            const common = ['--no-warnings', '--no-check-certificates', '--geo-bypass', '--retries', '3'];
            const hasCookies = fs.existsSync(cookiesFile) ? ['--cookies', cookiesFile] : [];
            if (tipo === 'audio') strategies.push([...common, ...hasCookies, '-x', '--audio-format', ext, '--audio-quality', '0', '-o', basePath, url]);
            else strategies.push([...common, ...hasCookies, '-f', 'best', '--merge-output-format', ext, '-o', basePath, url]);
            strategies.push([...common, ...hasCookies, '-f', 'best', '-o', basePath, url]);
        }

        // Ejecutar yt-dlp con fallback
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

        // FALLBACK A INVIDIOUS para YouTube si hubo error de bot
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
                ? 'YouTube bloquea IPs de datacenter. El servidor intentó Invidious como fallback. Si sigue fallando, prueba PO Token o ejecuta el servidor en local.'
                : platform === 'tiktok' && isTikTokPhoto(url) && mode === 'video'
                ? 'Los carruseles de TikTok son imágenes. Usa "Imágenes + Audio" o "Audio solo".'
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
    console.log(`[startup] Invidious instances: ${INVIDIOUS_INSTANCES.length}`);
});