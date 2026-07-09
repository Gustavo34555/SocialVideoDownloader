const express = require('express');
const cors = require('cors');
const { spawn, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const archiver = require('archiver');
const https = require('https');
const http = require('http');

const app = express();
app.use(cors());
app.use(express.json());

// Localiza ffmpeg.exe (instalado vía winget o en PATH)
function locateFfmpeg() {
    const candidates = [
        'ffmpeg',
        'C:/Users/zetas/AppData/Local/Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe/ffmpeg-8.1.2-full_build/bin/ffmpeg.exe',
        'C:/ffmpeg/bin/ffmpeg.exe',
        'C:/Program Files/ffmpeg/bin/ffmpeg.exe'
    ];
    for (const c of candidates) {
        try {
            if (fs.existsSync(c)) return c;
        } catch (_) {}
    }
    return 'ffmpeg';
}

const FFMPEG = locateFfmpeg();

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Normaliza URLs de TikTok: yt-dlp no soporta "/photo/ID" pero
// "/video/ID" con el mismo ID sí funciona y devuelve metadatos (incluido el audio).
function normalizeUrl(url) {
    if (!url) return url;
    try {
        const u = new URL(url);
        if (u.hostname.includes('tiktok.com')) {
            const m = u.pathname.match(/^\/(@[^/]+)\/(photo|video)\/(\d+)/);
            if (m) {
                u.pathname = `/${m[1]}/video/${m[3]}`;
                ['_r', '_t', 'is_from_webapp', 'sender_device', 'sender_web_id', 'web_id'].forEach(p => u.searchParams.delete(p));
                return u.toString();
            }
        }
    } catch (_) {}
    return url;
}

// Descarga un archivo (URL http/https) a una ruta local
function downloadToFile(url, dest) {
    return new Promise((resolve, reject) => {
        const proto = url.startsWith('https') ? https : http;
        const file = fs.createWriteStream(dest);
        proto.get(url, { headers: { 'User-Agent': USER_AGENT, 'Referer': 'https://www.tiktok.com/' } }, response => {
            if (response.statusCode && [301, 302, 303, 307, 308].includes(response.statusCode)) {
                file.close();
                fs.unlink(dest, () => {});
                return downloadToFile(response.headers.location, dest).then(resolve, reject);
            }
            if (response.statusCode !== 200) {
                file.close();
                fs.unlink(dest, () => {});
                return reject(new Error('HTTP ' + response.statusCode));
            }
            response.pipe(file);
            file.on('finish', () => file.close(() => resolve(dest)));
        }).on('error', err => {
            fs.unlink(dest, () => {});
            reject(err);
        });
    });
}

// Hace scraping de la página de TikTok para extraer URLs de imágenes y audio
// de un "image post". Devuelve { images: [urls], audio: url|null, title, author }
async function scrapeTikTokImagePost(url) {
    return new Promise((resolve, reject) => {
        const proto = url.startsWith('https') ? https : http;
        proto.get(url, { headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'en-US,en;q=0.9' } }, response => {
            if (response.statusCode && [301, 302, 303, 307, 308].includes(response.statusCode)) {
                return scrapeTikTokImagePost(response.headers.location).then(resolve, reject);
            }
            if (response.statusCode !== 200) {
                return reject(new Error('HTTP ' + response.statusCode + ' al descargar la página'));
            }
            let data = '';
            response.setEncoding('utf8');
            response.on('data', chunk => { data += chunk; });
            response.on('end', () => {
                try {
                    const marker = '__UNIVERSAL_DATA_FOR_REHYDRATION__';
                    const idx = data.indexOf(marker);
                    if (idx < 0) return reject(new Error('No se encontró el JSON embebido en la página'));

                    const jsonStart = data.indexOf('>', idx) + 1;
                    const jsonEnd = data.indexOf('</script>', jsonStart);
                    const jsonStr = data.slice(jsonStart, jsonEnd);
                    const parsed = JSON.parse(jsonStr);
                    const scope = parsed.__DEFAULT_SCOPE__ || {};
                    const detail = scope['webapp.video-detail'] || {};
                    const itemInfo = detail.itemInfo || {};
                    const item = itemInfo.itemStruct || {};
                    const imagePost = item.imagePost || {};

                    const images = (imagePost.images || [])
                        .map(img => {
                            const urlList = img.imageURL && img.imageURL.urlList;
                            return urlList && urlList.length ? urlList[urlList.length - 1] : null;
                        })
                        .filter(Boolean);

                    if (images.length === 0) {
                        return reject(new Error('La página no contiene imágenes'));
                    }

                    // Audio: TikTok lo expone en item.music.playUrl
                    const audio = (item.music && item.music.playUrl) || null;

                    resolve({
                        images,
                        audio,
                        title: item.desc || 'Publicación de TikTok',
                        author: (item.author && item.author.uniqueId) || 'usuario'
                    });
                } catch (e) {
                    reject(new Error('No se pudo parsear la página: ' + e.message));
                }
            });
        }).on('error', reject);
    });
}

// Intenta descargar imágenes con yt-dlp y devuelve la lista de archivos resultantes.
// Si yt-dlp no logra traer imágenes (caso image post de TikTok), devuelve [].
function downloadImagesWithYtdlp(url, tmpDir) {
    return new Promise((resolve, reject) => {
        const ytdlp = spawn('yt-dlp', [
            url,
            '-o', path.join(tmpDir, 'img_%03d.%(ext)s'),
            '--no-warnings'
        ]);
        let err = '';
        ytdlp.stderr.on('data', d => { err += d.toString(); });
        ytdlp.on('close', code => {
            if (code !== 0) {
                console.error('[ytdlp-img]', err);
                return reject(new Error('yt-dlp falló'));
            }
            const files = fs.readdirSync(tmpDir)
                .filter(f => /^img_\d+\./.test(f))
                .sort();
            resolve(files);
        });
    });
}

// 1. RUTA PARA ANALIZAR (Con evasión de anti-bots)
app.post('/api/analyze', (req, res) => {
    let videoUrl = req.body.url;
    if (!videoUrl) return res.status(400).json({ error: "Falta la URL" });
    videoUrl = normalizeUrl(videoUrl);

    execFile('yt-dlp', [
        '--dump-json',
        '--no-warnings',
        '--user-agent', USER_AGENT,
        videoUrl
    ], { maxBuffer: 1024 * 1024 * 50 }, (error, stdout, stderr) => {

        if (error) {
            const detalle = (stderr || error.message || '').split('\n').filter(l => l.trim())[0] || 'Error desconocido';
            return res.status(500).json({ error: "No se pudo analizar el enlace.", detalle: detalle.slice(0, 240) });
        }

        try {
            const metadata = JSON.parse(stdout);
            const isPlaylist = metadata._type === 'playlist' || (metadata.entries && metadata.entries.length > 1);

            // Para image posts de TikTok: detectamos cuando el título/desc apunta a uno
            // y avisamos al front que hay imágenes.
            const looksLikeImagePost = isPlaylist ||
                (metadata.extractor && metadata.extractor.includes('TikTok') &&
                 (!Array.isArray(metadata.formats) || !metadata.formats.some(f => f.vcodec && f.vcodec !== 'none')));

            const info = {
                titulo: metadata.title || metadata.description || "Publicación sin título",
                autor: metadata.uploader || metadata.creator || metadata.extractor || "Usuario desconocido",
                esCarrusel: looksLikeImagePost,
                cantidad: isPlaylist && metadata.entries ? metadata.entries.length : (looksLikeImagePost ? '?' : 1)
            };

            res.json(info);
        } catch (e) {
            res.status(500).json({ error: "El servidor de la red social devolvió datos ilegibles." });
        }
    });
});

// 2. RUTA PARA DESCARGAR VIDEOS NORMALES
app.get('/api/download-video', (req, res) => {
    const videoUrl = normalizeUrl(req.query.url);
    if (!videoUrl) return res.status(400).send("Falta la URL");

    res.header('Content-Disposition', 'attachment; filename="video_descargado.mp4"');
    res.header('Content-Type', 'video/mp4');

    const ytdlp = spawn('yt-dlp', ['-f', 'b[ext=mp4]/best', '-o', '-', videoUrl]);
    ytdlp.stdout.pipe(res);
    ytdlp.on('close', (code) => {
        if (code !== 0) console.error(`Error en descarga (Código ${code}).`);
    });
});

// 3. RUTA PARA DESCARGAR FOTOS DE CARRUSEL COMO ZIP
app.get('/api/download-images', async (req, res) => {
    const originalUrl = req.query.url;
    const videoUrl = normalizeUrl(originalUrl);
    if (!videoUrl) return res.status(400).send("Falta la URL");

    const tmpDir = path.join(os.tmpdir(), 'carousel_' + Date.now());
    fs.mkdirSync(tmpDir, { recursive: true });

    const cleanup = () => { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {} };

    try {
        // Intento 1: yt-dlp
        let files = [];
        try {
            files = await downloadImagesWithYtdlp(videoUrl, tmpDir);
        } catch (e) {
            console.warn('[zip] yt-dlp no trajo imágenes:', e.message);
        }

        // Intento 2: scraping de TikTok (image post)
        if (files.length === 0 && originalUrl && originalUrl.includes('tiktok.com')) {
            console.log('[zip] Fallback a scraping de TikTok');
            const scraped = await scrapeTikTokImagePost(videoUrl);
            for (let i = 0; i < scraped.images.length; i++) {
                const ext = (scraped.images[i].match(/\.(jpe?g|png|webp)/i) || [, '.jpg'])[1] || 'jpg';
                const dest = path.join(tmpDir, `img_${String(i + 1).padStart(3, '0')}.${ext}`);
                await downloadToFile(scraped.images[i], dest);
            }
            files = fs.readdirSync(tmpDir).filter(f => /^img_\d+\./.test(f)).sort();
        }

        if (files.length === 0) {
            cleanup();
            return res.status(404).send("No se encontraron imágenes en el enlace.");
        }

        res.header('Content-Disposition', 'attachment; filename="fotos_carrusel.zip"');
        res.header('Content-Type', 'application/zip');

        const archive = archiver('zip', { zlib: { level: 9 } });
        archive.on('error', err => { console.error('Error ZIP:', err); cleanup(); });
        archive.pipe(res);

        files.forEach(file => {
            const filePath = path.join(tmpDir, file);
            if (fs.statSync(filePath).isFile()) archive.file(filePath, { name: file });
        });

        await archive.finalize();
        res.on('close', cleanup);

    } catch (err) {
        console.error('[zip] Error:', err);
        cleanup();
        res.status(500).send("Error descargando las imágenes: " + err.message);
    }
});

// 4. RUTA PARA CONVERTIR CARRUSEL DE FOTOS A VIDEO MP4 + AUDIO
app.get('/api/download-slideshow', async (req, res) => {
    const originalUrl = req.query.url;
    const videoUrl = normalizeUrl(originalUrl);
    if (!videoUrl) return res.status(400).send("Falta la URL");

    const tmpDir = path.join(os.tmpdir(), 'slideshow_' + Date.now());
    fs.mkdirSync(tmpDir, { recursive: true });
    const cleanup = () => { try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {} };

    try {
        console.log(`[slideshow] URL: ${originalUrl}`);

        // 1) Obtener metadatos con yt-dlp (título, autor, audio)
        const metadata = await new Promise((resolve, reject) => {
            execFile('yt-dlp', ['--dump-json', '--no-warnings', videoUrl],
                { maxBuffer: 1024 * 1024 * 50 }, (err, stdout, stderr) => {
                    if (err) return reject(new Error(stderr || err.message));
                    try { resolve(JSON.parse(stdout)); }
                    catch (e) { reject(new Error('JSON inválido')); }
                });
        });

        // 2) Bajar imágenes (yt-dlp primero, scraping como fallback)
        let files = [];
        try {
            files = await downloadImagesWithYtdlp(videoUrl, tmpDir);
        } catch (e) {
            console.warn('[slideshow] yt-dlp no trajo imágenes:', e.message);
        }

        if (files.length === 0 && originalUrl && originalUrl.includes('tiktok.com')) {
            console.log('[slideshow] Fallback a scraping de TikTok');
            const scraped = await scrapeTikTokImagePost(videoUrl);
            for (let i = 0; i < scraped.images.length; i++) {
                const ext = (scraped.images[i].match(/\.(jpe?g|png|webp)/i) || [, '.jpg'])[1] || 'jpg';
                const dest = path.join(tmpDir, `img_${String(i + 1).padStart(3, '0')}.${ext}`);
                await downloadToFile(scraped.images[i], dest);
            }
            files = fs.readdirSync(tmpDir).filter(f => /^img_\d+\./.test(f)).sort();
        }

        if (files.length === 0) {
            cleanup();
            return res.status(404).send("No se encontraron imágenes para el slideshow.");
        }

        console.log(`[slideshow] ${files.length} imágenes listas`);

        // 3) Audio: yt-dlp a veces no lo expone para image posts, así que
        //    probamos también el campo music.playUrl del scraping.
        let audioUrl = findAudioUrl(metadata);
        if (!audioUrl && originalUrl && originalUrl.includes('tiktok.com')) {
            try {
                const scraped = await scrapeTikTokImagePost(videoUrl);
                if (scraped.audio) audioUrl = scraped.audio;
            } catch (_) {}
        }

        // 4) Construir el slideshow
        const perImageSec = 3;
        const concatList = path.join(tmpDir, 'list.txt');
        const lines = files.map(f => {
            const p = path.join(tmpDir, f).replace(/'/g, "'\\''");
            return `file '${p}'\nduration ${perImageSec}`;
        });
        lines.push(`file '${path.join(tmpDir, files[files.length - 1]).replace(/'/g, "'\\''")}'`);
        fs.writeFileSync(concatList, lines.join('\n'));

        const videoPath = path.join(tmpDir, 'video.mp4');
        const outPath = path.join(tmpDir, 'output.mp4');

        await new Promise((resolve, reject) => {
            const ff = spawn(FFMPEG, [
                '-y', '-f', 'concat', '-safe', '0', '-i', concatList,
                '-vf', 'scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,format=yuv420p',
                '-r', '30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p',
                videoPath
            ]);
            let err = '';
            ff.stderr.on('data', d => { err += d.toString(); });
            ff.on('close', code => code === 0 ? resolve() : reject(new Error('ffmpeg base: ' + err.slice(-500))));
        });

        // 5) Mezclar audio (o pista vacía) y devolver
        const audioPath = path.join(tmpDir, 'audio');
        let audioFile = null;
        if (audioUrl) {
            try { await downloadToFile(audioUrl, audioPath); audioFile = audioPath; }
            catch (e) { console.warn('[slideshow] No se descargó el audio:', e.message); }
        }

        const ffArgs = ['-y', '-i', videoPath];
        if (audioFile) ffArgs.push('-i', audioFile, '-c:a', 'aac', '-b:a', '192k');
        ffArgs.push('-c:v', 'copy', '-shortest', outPath);

        await new Promise((resolve, reject) => {
            const ff = spawn(FFMPEG, ffArgs);
            let err = '';
            ff.stderr.on('data', d => { err += d.toString(); });
            ff.on('close', code => code === 0 ? resolve() : reject(new Error('ffmpeg final: ' + err.slice(-500))));
        });

        res.header('Content-Disposition', 'attachment; filename="slideshow.mp4"');
        res.header('Content-Type', 'video/mp4');
        fs.createReadStream(outPath).pipe(res);
        res.on('close', cleanup);

    } catch (err) {
        console.error('[slideshow] Error:', err);
        cleanup();
        res.status(500).send("Error generando el slideshow: " + (err.message || err));
    }
});

// Busca una URL de audio en los formatos reportados por yt-dlp
function findAudioUrl(metadata) {
    if (!metadata) return null;
    if (metadata.music_info && metadata.music_info.url) return metadata.music_info.url;
    if (metadata.track && metadata.track.url) return metadata.track.url;
    if (metadata.music) return metadata.music;
    const entries = metadata.entries || [metadata];
    for (const e of entries) {
        if (!e) continue;
        if (e.music_info && e.music_info.url) return e.music_info.url;
        if (e.track && e.track.url) return e.track.url;
        if (e.music) return e.music;
        if (Array.isArray(e.formats)) {
            const audioOnly = e.formats
                .filter(f => f.acodec && f.acodec !== 'none' && (f.vcodec === 'none' || !f.vcodec))
                .sort((a, b) => (b.abr || 0) - (a.abr || 0))[0];
            if (audioOnly && audioOnly.url) return audioOnly.url;
        }
    }
    return null;
}

app.listen(3000, () => {
    console.log('Servidor corriendo en http://localhost:3000');
    console.log('ffmpeg:', FFMPEG);
});
