const express = require('express');
const cors = require('cors');
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const app = express();

/* ─── Middlewares ─── */
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '.')));

/* ─── Config ─── */
const PORT = process.env.PORT || 3000;
const TMP_DIR = process.env.TMP_DIR || path.join(os.tmpdir(), 'ytdl');
const YTDLP = '/usr/local/bin/yt-dlp'; // symlink del Dockerfile

if (!fs.existsSync(TMP_DIR)) {
    fs.mkdirSync(TMP_DIR, { recursive: true });
}

/* ─── Helpers ─── */
const sanitize = (s) => (s || 'video').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').substring(0, 120);

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

function runYtDlp(args, timeout = 300000) {
    return new Promise((resolve, reject) => {
        const proc = spawn(YTDLP, args);
        let stderr = '', stdout = '';
        proc.stderr.on('data', d => stderr += d);
        proc.stdout.on('data', d => stdout += d);

        const t = setTimeout(() => {
            proc.kill('SIGTERM');
            reject(new Error('Timeout: la operación tardó demasiado'));
        }, timeout);

        proc.on('close', code => {
            clearTimeout(t);
            if (code === 0) return resolve(stdout);
            const err = stderr.split('\n').filter(l => l.trim()).pop() || `Exit ${code}`;
            reject(new Error(err));
        });
        proc.on('error', err => { clearTimeout(t); reject(err); });
    });
}

function cleanup(basePath) {
    ['', '.mp4', '.webm', '.mkv', '.mp3', '.m4a', '.opus', '.ogg', '.part'].forEach(ext => {
        try { fs.unlinkSync(basePath + ext); } catch (_) {}
    });
}

/* ─── GET /api/info ─── */
app.get('/api/info', async (req, res) => {
    const { url } = req.query;
    if (!url || !/^https?:\/\/.+/.test(url)) {
        return res.status(400).json({ error: 'URL inválida' });
    }
    try {
        const out = await runYtDlp(['--dump-json', '--no-playlist', '--no-warnings', url], 30000);
        const d = JSON.parse(out);
        res.json({
            title: d.title,
            duration: d.duration,
            thumbnail: d.thumbnail,
            uploader: d.uploader,
            platform: detectPlatform(url)
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

/* ─── POST /api/download ─── */
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
        // 1. Título
        try {
            const out = await runYtDlp(['--dump-json', '--no-playlist', '--no-warnings', url], 30000);
            title = sanitize(JSON.parse(out).title);
        } catch (e) {
            console.warn('[warn] Sin título:', e.message);
        }

        // 2. Estrategias
        const ext = formato || (tipo === 'audio' ? 'mp3' : 'mp4');
        const strategies = [];

        if (tipo === 'audio') {
            strategies.push(
                ['-x', '--audio-format', ext, '--audio-quality', '0', '-o', basePath],
                ['-f', 'bestaudio', '-x', '--audio-format', 'mp3', '--audio-quality', '0', '-o', basePath]
            );
        } else {
            const fmap = {
                mp4: 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best',
                webm: 'bestvideo[ext=webm]+bestaudio[ext=webm]/best[ext=webm]/best',
                mkv: 'bestvideo+bestaudio/best'
            };
            const sel = fmap[ext] || 'bestvideo+bestaudio/best';
            strategies.push(
                ['-f', sel, '--merge-output-format', ext, '-o', basePath],
                ['-f', 'best', '--remux-video', ext, '-o', basePath],
                ['-f', 'best', '-o', basePath]
            );
        }

        // 3. Ejecutar con fallback
        let finalFile = null, lastErr = null;
        for (let i = 0; i < strategies.length; i++) {
            try {
                console.log(`[dl] ${platform} | strategy ${i + 1}/${strategies.length}`);
                await runYtDlp([...strategies[i], '--no-warnings', '--no-check-certificates', url]);

                const candidates = [ext, 'mp4', 'webm', 'mkv', 'mp3', 'm4a', 'opus', 'ogg']
                    .map(e => `${basePath}.${e}`);
                candidates.push(basePath);

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
            }
        }
        if (lastErr) throw lastErr;
        if (!finalFile) throw new Error('No se generó el archivo');

        const stat = fs.statSync(finalFile);
        if (stat.size === 0) throw new Error('Archivo vacío');

        // 4. Stream al navegador
        const mime = {
            mp4: 'video/mp4', webm: 'video/webm', mkv: 'video/x-matroska',
            mp3: 'audio/mpeg', m4a: 'audio/mp4', opus: 'audio/ogg',
            ogg: 'audio/ogg', flac: 'audio/flac', wav: 'audio/wav'
        };
        const outExt = path.extname(finalFile).slice(1) || ext;
        const filename = `${title}.${outExt}`;

        res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
        res.setHeader('Content-Type', mime[outExt] || (tipo === 'audio' ? 'audio/mpeg' : 'video/mp4'));
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
        console.error('[dl] Error:', err.message);
        if (!res.headersSent) res.status(500).json({ error: err.message || 'Error en descarga' });
    }
});

/* ─── Health check ─── */
app.get('/healthz', (req, res) => res.json({ ok: true, port: PORT }));

/* ─── Startup ─── */
execFile(YTDLP, ['-U'], { timeout: 60000 }, () => {}); // intenta actualizar silenciosamente
execFile(YTDLP, ['--version'], { timeout: 10000 }, (err, stdout) => {
    if (err) console.error('[startup] yt-dlp NO disponible:', err.message);
    else console.log('[startup] yt-dlp versión:', stdout.trim());
});

app.listen(PORT, '0.0.0.0', () => console.log(`[startup] Puerto ${PORT}`));