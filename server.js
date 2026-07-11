const express = require('express');
const cors = require('cors');
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const app = express();

/* ═══════════════════════════════════════════
   CONFIGURACIÓN Y CONSTANTES
═══════════════════════════════════════════ */
const PORT = process.env.PORT || 3000;
const TMP_DIR = process.env.TMP_DIR || path.join(os.tmpdir(), 'ytdl');
const YTDLP = '/usr/local/bin/yt-dlp';
const COOKIES_DIR = path.join(__dirname, 'cookies');

// Asegurar directorios existen
if (!fs.existsSync(TMP_DIR)) fs.mkdirSync(TMP_DIR, { recursive: true });
if (!fs.existsSync(COOKIES_DIR)) fs.mkdirSync(COOKIES_DIR, { recursive: true });

/* ═══════════════════════════════════════════
   MIDDLEWARES
═══════════════════════════════════════════ */
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '.')));

/* ═══════════════════════════════════════════
   UTILIDADES
═══════════════════════════════════════════ */
const sanitize = (s) => (s || 'video').replace(/[<>:"\/\\|?*\x00-\x1f]/g, '_').substring(0, 120);

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
        ['dailymotion', /dailymotion\.com/i],
        ['bilibili', /bilibili\.com/i],
    ];
    for (const [name, re] of map) if (re.test(url)) return name;
    return 'unknown';
}

function isTikTokPhoto(url) {
    return /tiktok\.com\/.*\/photo\//i.test(url);
}

function cleanup(basePath) {
    const exts = ['', '.mp4', '.webm', '.mkv', '.mp3', '.m4a', '.opus', '.ogg', '.flac', '.wav', '.part', '.ytdl'];
    exts.forEach(ext => {
        try { fs.unlinkSync(basePath + ext); } catch (_) {}
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
            setTimeout(() => proc.kill('SIGKILL'), 5000);
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

// Genera estrategias anti-bot según la plataforma
function buildStrategies(platform, tipo, ext, basePath, url) {
    const strategies = [];
    const cookiesFile = path.join(COOKIES_DIR, 'cookies.txt');
    const hasCookies = fs.existsSync(cookiesFile);
    const cookieArg = hasCookies ? ['--cookies', cookiesFile] : [];

    // Args comunes para evitar bloqueos
    const commonArgs = [
        '--no-warnings',
        '--no-check-certificates',
        '--geo-bypass',
        '--retries', '3',
        '--fragment-retries', '3',
        '--skip-unavailable-fragments',
        ...cookieArg
    ];

    if (platform === 'youtube') {
        // Estrategias anti-bot para YouTube (datacenter IPs)
        const clients = [
            'tv_downgraded',
            'web',
            'android_vr',
            'mweb',
            'web_creator',
            'ios'
        ];

        clients.forEach(client => {
            const extractorArgs = `--extractor-args youtube:player_client=${client}`;
            if (tipo === 'audio') {
                strategies.push([
                    ...commonArgs,
                    extractorArgs,
                    '-x', '--audio-format', ext,
                    '--audio-quality', '0',
                    '-o', basePath,
                    url
                ]);
            } else {
                const fmap = {
                    mp4: 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
                    webm: 'bestvideo[ext=webm]+bestaudio[ext=webm]/best[ext=webm]/best',
                    mkv: 'bestvideo+bestaudio/best'
                };
                const sel = fmap[ext] || 'bestvideo+bestaudio/best';
                strategies.push([
                    ...commonArgs,
                    extractorArgs,
                    '-f', sel,
                    '--merge-output-format', ext,
                    '-o', basePath,
                    url
                ]);
            }
        });

        // Fallback: formatos progresivos (sin merge, más compatible)
        strategies.push([
            ...commonArgs,
            '--extractor-args', 'youtube:player_client=tv_downgraded',
            '-f', 'best[height<=1080]',
            '-o', basePath,
            url
        ]);
    }
    else if (platform === 'tiktok') {
        if (isTikTokPhoto(url)) {
            // TikTok Photo Carousel: intentar descargar como slideshow
            // yt-dlp a veces puede extraer imágenes con el extractor genérico
            strategies.push([
                ...commonArgs,
                '--force-generic-extractor',
                '-o', basePath,
                url
            ]);
            // Otra estrategia: intentar con el extractor de TikTok directo
            strategies.push([
                ...commonArgs,
                '--extractor-args', 'tiktok:api=web',
                '-o', basePath,
                url
            ]);
        } else {
            // Video normal de TikTok
            if (tipo === 'audio') {
                strategies.push([
                    ...commonArgs,
                    '-x', '--audio-format', ext,
                    '--audio-quality', '0',
                    '-o', basePath,
                    url
                ]);
            } else {
                strategies.push([
                    ...commonArgs,
                    '-f', 'best',
                    '--merge-output-format', ext,
                    '-o', basePath,
                    url
                ]);
            }
            // Fallback con user-agent alternativo
            strategies.push([
                ...commonArgs,
                '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                '-f', 'best',
                '-o', basePath,
                url
            ]);
        }
    }
    else {
        // Estrategia genérica para otras plataformas
        if (tipo === 'audio') {
            strategies.push([
                ...commonArgs,
                '-x', '--audio-format', ext,
                '--audio-quality', '0',
                '-o', basePath,
                url
            ]);
        } else {
            const fmap = {
                mp4: 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
                webm: 'bestvideo[ext=webm]+bestaudio[ext=webm]/best[ext=webm]/best',
                mkv: 'bestvideo+bestaudio/best'
            };
            const sel = fmap[ext] || 'bestvideo+bestaudio/best';
            strategies.push([
                ...commonArgs,
                '-f', sel,
                '--merge-output-format', ext,
                '-o', basePath,
                url
            ]);
        }
        // Fallback universal
        strategies.push([
            ...commonArgs,
            '-f', 'best',
            '-o', basePath,
            url
        ]);
    }

    return strategies;
}

/* ═══════════════════════════════════════════
   ENDPOINTS
═══════════════════════════════════════════ */

// GET /api/info - Obtener metadatos del video
app.get('/api/info', async (req, res) => {
    const { url } = req.query;
    if (!url || !/^https?:\/\/.+/.test(url)) {
        return res.status(400).json({ error: 'URL inválida' });
    }

    const platform = detectPlatform(url);
    const cookiesFile = path.join(COOKIES_DIR, 'cookies.txt');
    const hasCookies = fs.existsSync(cookiesFile) ? ['--cookies', cookiesFile] : [];

    // Estrategias de info según plataforma
    const infoStrategies = [];

    if (platform === 'youtube') {
        ['tv_downgraded', 'web', 'android_vr', 'mweb'].forEach(client => {
            infoStrategies.push([
                '--dump-json', '--no-playlist', '--no-warnings',
                '--extractor-args', `youtube:player_client=${client}`,
                ...hasCookies,
                url
            ]);
        });
    } else if (platform === 'tiktok' && isTikTokPhoto(url)) {
        infoStrategies.push([
            '--dump-json', '--no-warnings', '--force-generic-extractor',
            ...hasCookies,
            url
        ]);
    } else {
        infoStrategies.push([
            '--dump-json', '--no-playlist', '--no-warnings',
            ...hasCookies,
            url
        ]);
    }

    let lastErr = null;
    for (let i = 0; i < infoStrategies.length; i++) {
        try {
            console.log(`[info] ${platform} | strategy ${i + 1}/${infoStrategies.length}`);
            const out = await runYtDlp(infoStrategies[i], 30000);
            const d = JSON.parse(out);

            // Detectar si es slideshow/carousel
            const isSlideshow = d.entries && Array.isArray(d.entries);

            return res.json({
                title: d.title || 'Sin título',
                duration: d.duration,
                thumbnail: d.thumbnail,
                uploader: d.uploader,
                platform: platform,
                isSlideshow: isSlideshow,
                formats_count: d.formats ? d.formats.length : 0,
                description: d.description?.substring(0, 200)
            });
        } catch (e) {
            console.error(`[info] strategy ${i + 1} failed: ${e.message}`);
            lastErr = e;
        }
    }

    res.status(500).json({ 
        error: lastErr?.message || 'No se pudo obtener información',
        tip: platform === 'youtube' 
            ? 'YouTube está bloqueando IPs de datacenter. Intenta subir cookies o usar un proxy.' 
            : 'Verifica que la URL sea pública y accesible.'
    });
});

// POST /api/download - Descargar archivo
app.post('/api/download', async (req, res) => {
    const { url, tipo = 'video', formato } = req.body;
    if (!url || !/^https?:\/\/.+/.test(url)) {
        return res.status(400).json({ error: 'URL inválida' });
    }

    const platform = detectPlatform(url);
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
    const basePath = path.join(TMP_DIR, id);
    let title = 'video';

    try {
        // 1. Obtener título
        try {
            const cookiesFile = path.join(COOKIES_DIR, 'cookies.txt');
            const hasCookies = fs.existsSync(cookiesFile) ? ['--cookies', cookiesFile] : [];
            const infoArgs = ['--dump-json', '--no-playlist', '--no-warnings', ...hasCookies];

            if (platform === 'youtube') {
                infoArgs.push('--extractor-args', 'youtube:player_client=tv_downgraded');
            }

            const out = await runYtDlp([...infoArgs, url], 30000);
            title = sanitize(JSON.parse(out).title);
        } catch (e) {
            console.warn('[warn] Sin título:', e.message);
        }

        // 2. Construir estrategias
        const ext = formato || (tipo === 'audio' ? 'mp3' : 'mp4');
        const strategies = buildStrategies(platform, tipo, ext, basePath, url);

        // 3. Ejecutar con fallback
        let finalFile = null, lastErr = null;
        for (let i = 0; i < strategies.length; i++) {
            try {
                console.log(`[dl] ${platform} | strategy ${i + 1}/${strategies.length}`);
                await runYtDlp(strategies[i]);

                // Buscar archivo generado
                const candidates = [ext, 'mp4', 'webm', 'mkv', 'mp3', 'm4a', 'opus', 'ogg', 'flac', 'wav']
                    .map(e => `${basePath}.${e}`);
                candidates.push(basePath); // sin extensión

                for (const f of candidates) {
                    if (fs.existsSync(f)) { finalFile = f; break; }
                }
                if (!finalFile) throw new Error('Archivo no generado');
                lastErr = null;
                break;
            } catch (e) {
                console.error(`[dl] strategy ${i + 1} failed: ${e.message}`);
                lastErr = e;
                cleanup(basePath);
                // Pequeño delay entre reintentos
                if (i < strategies.length - 1) await new Promise(r => setTimeout(r, 1000));
            }
        }

        if (lastErr) throw lastErr;
        if (!finalFile) throw new Error('No se generó el archivo después de todos los intentos');

        const stat = fs.statSync(finalFile);
        if (stat.size === 0) throw new Error('Archivo vacío');

        // 4. Enviar al navegador
        const mime = {
            mp4: 'video/mp4', webm: 'video/webm', mkv: 'video/x-matroska',
            mp3: 'audio/mpeg', m4a: 'audio/mp4', opus: 'audio/ogg',
            ogg: 'audio/ogg', flac: 'audio/flac', wav: 'audio/wav',
            jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif'
        };
        const outExt = path.extname(finalFile).slice(1) || ext;
        const filename = `${title}.${outExt}`;

        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
        res.setHeader('Content-Type', mime[outExt] || 'application/octet-stream');
        res.setHeader('Content-Length', stat.size);

        const stream = fs.createReadStream(finalFile);
        stream.pipe(res);

        stream.on('close', () => cleanup(basePath));
        stream.on('error', () => {
            cleanup(basePath);
            if (!res.headersSent) res.status(500).end();
        });

    } catch (err) {
        cleanup(basePath);
        console.error('[dl] Error final:', err.message);
        if (!res.headersSent) {
            res.status(500).json({ 
                error: err.message || 'Error en descarga',
                tip: platform === 'youtube' && err.message?.includes('bot')
                    ? 'YouTube detectó IP de datacenter. Soluciones: 1) Sube cookies.txt 2) Usa Cloudflare WARP 3) Cambia a proxy residencial'
                    : platform === 'tiktok' && isTikTokPhoto(url)
                    ? 'Los carruseles de TikTok son slideshows de imágenes. yt-dlp tiene soporte limitado. Intenta con un video normal.'
                    : null
            });
        }
    }
});

// POST /api/cookies - Subir cookies para evitar bloqueos
app.post('/api/cookies', (req, res) => {
    const { content } = req.body;
    if (!content) return res.status(400).json({ error: 'Contenido vacío' });

    try {
        fs.writeFileSync(path.join(COOKIES_DIR, 'cookies.txt'), content);
        res.json({ ok: true, message: 'Cookies guardadas' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// GET /healthz - Health check para Render
app.get('/healthz', (req, res) => {
    res.json({ 
        ok: true, 
        port: PORT,
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

// GET /api/version - Info del servidor
app.get('/api/version', async (req, res) => {
    try {
        const version = await runYtDlp(['--version'], 10000);
        res.json({ 
            yt_dlp: version.trim(),
            node: process.version,
            platform: process.platform
        });
    } catch (e) {
        res.status(500).json({ error: 'No se pudo obtener versión de yt-dlp' });
    }
});

/* ═══════════════════════════════════════════
   STARTUP
═══════════════════════════════════════════ */

// Actualizar yt-dlp al arrancar (silencioso)
execFile(YTDLP, ['-U'], { timeout: 60000 }, (err, stdout) => {
    if (!err) console.log('[startup] yt-dlp actualizado:', stdout.trim());
});

execFile(YTDLP, ['--version'], { timeout: 10000 }, (err, stdout) => {
    if (err) console.error('[startup] yt-dlp NO disponible:', err.message);
    else console.log('[startup] yt-dlp versión:', stdout.trim());
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`[startup] Servidor activo en puerto ${PORT}`);
    console.log(`[startup] TMP_DIR: ${TMP_DIR}`);
    console.log(`[startup] Cookies: ${COOKIES_DIR}`);
});
