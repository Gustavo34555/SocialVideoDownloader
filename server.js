const express = require('express');
const cors = require('cors');
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const https = require('https');
const http = require('http');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(__dirname));

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

console.log(`[SISTEMA] Archivo cookies.txt detectado: ${fs.existsSync('cookies.txt') ? 'SÍ ✅' : 'NO ❌'}`);

// ==========================================
// UTILIDADES Y RESOLUCIÓN DE URL
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

async function prepareUrl(inputUrl) {
    let url = (inputUrl || '').trim();
    if (/https?:\/\/(vt|vm)\.tiktok\.com/i.test(url)) {
        try { url = await followRedirect(url); } catch (_) {}
    }
    return cleanUrl(url).replace('/photo/', '/video/'); // Forzar lectura de video en TikToks
}

// ==========================================
// INTERACCIÓN CON YT-DLP
// ==========================================
app.post('/api/analyze', async (req, res) => {
    if (!req.body.url) return res.status(400).json({ error: "Ingresa un enlace válido." });

    const targetUrl = await prepareUrl(req.body.url);
    const args = ['--dump-json', '--no-warnings'];
    if (fs.existsSync('cookies.txt')) args.push('--cookies', 'cookies.txt');
    args.push(targetUrl);

    execFile('yt-dlp', args, { maxBuffer: 1024 * 1024 * 50 }, (error, stdout, stderr) => {
        if (error) {
            console.error(stderr);
            return res.status(500).json({ error: "Error al analizar. Revisa el enlace o intenta de nuevo." });
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
                thumbnail: data.thumbnail || null,
                puedeVideo: videos.length > 0,
                puedeAudio: audios.length > 0,
                formatos: { videos, audios }
            });
        } catch (e) {
            res.status(500).json({ error: "Datos de red social ilegibles." });
        }
    });
});

app.get('/api/download', async (req, res) => {
    const targetUrl = await prepareUrl(req.query.url);
    const { formatId = 'best', tipo = 'video' } = req.query;
    const tmpFile = path.join(os.tmpdir(), `dl_${Date.now()}.mp4`);

    let formatArg = formatId === 'best' 
        ? (tipo === 'audio' ? 'bestaudio/best' : 'bestvideo+bestaudio/best')
        : (tipo === 'video' ? `${formatId}+bestaudio/best` : formatId);

    const args = ['-f', formatArg, '--merge-output-format', 'mp4', '-o', tmpFile, '--no-warnings'];
    if (fs.existsSync('cookies.txt')) args.push('--cookies', 'cookies.txt');
    args.push(targetUrl);

    const ytdlp = spawn('yt-dlp', args);
    ytdlp.on('close', code => {
        if (code !== 0 || !fs.existsSync(tmpFile)) {
            return res.status(500).send("Error en la descarga interna de yt-dlp.");
        }
        const finalExt = tipo === 'audio' ? 'mp3' : 'mp4';
        const contentType = tipo === 'audio' ? 'audio/mpeg' : 'video/mp4';
        
        res.header('Content-Disposition', `attachment; filename="Descarga_${Date.now()}.${finalExt}"`);
        res.header('Content-Type', contentType);
        
        const stream = fs.createReadStream(tmpFile);
        stream.pipe(res);
        stream.on('close', () => fs.unlinkSync(tmpFile));
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`Servidor de Descargas activo -> Puerto ${PORT}`));