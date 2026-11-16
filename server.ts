import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { spawn } from 'child_process';
import fs from 'fs';
import { randomUUID } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;

// Ensure downloads and temp folders exist
const DOWNLOADS_DIR = path.join(__dirname, 'downloads');
if (!fs.existsSync(DOWNLOADS_DIR)) {
  fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
}

const TEMP_DIR = path.join(__dirname, 'temp');
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// In-memory download task tracker
interface DownloadTask {
  id: string;
  url: string;
  title: string;
  format: string;
  ext: string;
  status: 'pending' | 'downloading' | 'completed' | 'error';
  progress: number;
  speed?: string;
  eta?: string;
  filePath?: string;
  fileSize?: string;
  error?: string;
  createdAt: number;
}

const tasks = new Map<string, DownloadTask>();

// Cleanup old files older than 30 minutes
setInterval(() => {
  const now = Date.now();
  for (const [id, task] of tasks.entries()) {
    if (now - task.createdAt > 30 * 60 * 1000) {
      if (task.filePath && fs.existsSync(task.filePath)) {
        try {
          fs.unlinkSync(task.filePath);
        } catch (e) {
          console.error(`Failed to delete temp file ${task.filePath}:`, e);
        }
      }
      tasks.delete(id);
    }
  }
}, 5 * 60 * 1000);

app.use(express.json());

// Presets
const PRESETS = [
  {
    platform: 'youtube',
    platformName: 'YouTube Shorts',
    title: 'Adam Sevani Dance (熱門短影音)',
    url: 'https://www.youtube.com/shorts/UfDjzuI-0Qw',
    description: '街舞熱門短片，支援免驗證專線下載'
  },
  {
    platform: 'tiktok',
    platformName: 'TikTok (免浮水印)',
    title: 'TikTok Trending Video',
    url: 'https://www.tiktok.com/@tiktok/video/7106594312292453675',
    description: '官方熱門短影音，支援無水印提取'
  },
  {
    platform: 'youtube',
    platformName: 'YouTube Shorts',
    title: 'Never Gonna Give You Up (Short)',
    url: 'https://www.youtube.com/shorts/dQw4w9WgXcQ',
    description: '經典短片，支援原畫質 MP4 與 MP3'
  }
];

app.get('/api/presets', (_req, res) => {
  res.json({ presets: PRESETS });
});

// Helper: extract YouTube Video ID
function extractYouTubeId(url: string): string | null {
  const match = url.match(/(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?|shorts)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i);
  return match ? match[1] : null;
}

// Helper: extract Instagram Shortcode
function extractInstagramCode(url: string): string | null {
  const match = url.match(/(?:instagram\.com\/(?:p|reel|tv)\/)([^/?#&]+)/i);
  return match ? match[1] : null;
}

// Helper: detect platform from URL
function detectPlatform(url: string): string {
  const lower = url.toLowerCase();
  if (lower.includes('youtube.com') || lower.includes('youtu.be')) return 'youtube';
  if (lower.includes('instagram.com')) return 'instagram';
  if (lower.includes('tiktok.com')) return 'tiktok';
  if (lower.includes('facebook.com') || lower.includes('fb.watch')) return 'facebook';
  if (lower.match(/\.(mp4|mov|webm)(\?.*)?$/i) || lower.includes('cdninstagram.com') || lower.includes('tiktokcdn')) return 'direct';
  return 'general';
}

function formatDuration(sec: number): string {
  if (!sec || isNaN(sec)) return '0:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

function formatCookiesFile(cookieStr: string, domain: string, outPath: string) {
  const trimmed = cookieStr.trim();
  if (trimmed.includes('# Netscape') || trimmed.includes('\t')) {
    fs.writeFileSync(outPath, trimmed, 'utf-8');
    return;
  }
  const lines = ['# Netscape HTTP Cookie File'];
  const pairs = trimmed.split(/;\s*/);
  for (const pair of pairs) {
    const idx = pair.indexOf('=');
    if (idx > -1) {
      const k = pair.substring(0, idx).trim();
      const v = pair.substring(idx + 1).trim();
      if (k && v) {
        lines.push(`.${domain}\tTRUE\t/\tTRUE\t2147483647\t${k}\t${v}`);
      }
    }
  }
  fs.writeFileSync(outPath, lines.join('\n'), 'utf-8');
}

// 1. TikTok Dedicated Parser (tikwm - bypasses all anti-bot restrictions)
async function parseTikTok(url: string) {
  const response = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(url)}`, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
  });

  const json = await response.json();
  if (json.code !== 0 || !json.data) {
    throw new Error(json.msg || 'TikTok 伺服器回應錯誤，請確認網址格式');
  }

  const d = json.data;
  const formats = [
    {
      id: 'tiktok-clean',
      label: 'MP4 高畫質 (無浮水印 No Watermark)',
      type: 'video',
      quality: '1080p / 原畫質',
      ext: 'mp4',
      description: '已自動移除 TikTok 官方浮水印',
      directUrl: d.play
    },
    {
      id: 'tiktok-wm',
      label: 'MP4 原版 (保留官方浮水印)',
      type: 'video',
      quality: '原版畫質',
      ext: 'mp4',
      description: '保留創作者官方浮水印',
      directUrl: d.wmplay
    },
    {
      id: 'tiktok-audio',
      label: 'MP3 純音樂 (原創背景音樂)',
      type: 'audio',
      quality: '高品質音訊',
      ext: 'mp3',
      description: '提取熱門背景音樂或原聲音軌',
      directUrl: d.music
    }
  ];

  return {
    id: d.id || randomUUID(),
    url,
    title: d.title || 'TikTok 短影音',
    thumbnail: d.cover,
    duration: d.duration || 0,
    durationFormatted: formatDuration(d.duration || 0),
    uploader: d.author?.nickname || d.author?.unique_id || 'TikTok 創作者',
    platform: 'tiktok',
    viewCount: d.play_count,
    likeCount: d.digg_count,
    directUrl: d.play,
    formats
  };
}

// 2. YouTube oEmbed Fallback Parser
async function parseYouTubeOEmbed(url: string, videoId: string) {
  const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
  const fetchRes = await fetch(oembedUrl);
  if (!fetchRes.ok) {
    throw new Error('無法取得 YouTube 影片基本資料');
  }

  const data = await fetchRes.json();
  const title = data.title || 'YouTube 短影音';
  const uploader = data.author_name || 'YouTube 創作者';
  const thumbnail = data.thumbnail_url || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

  const formats = [
    {
      id: 'external-ss',
      label: '一鍵快速下載 (SS 免驗證專線)',
      type: 'video',
      quality: '1080p / 720p 高畫質',
      ext: 'mp4',
      description: '點擊立即在新分頁下載，自動繞過雲端機器人驗證',
      externalUrl: `https://www.ssyoutube.com/watch?v=${videoId}`
    },
    {
      id: 'external-y2mate',
      label: 'Y2Mate 專用通道 (MP4 / MP3)',
      type: 'video',
      quality: '全畫質支援',
      ext: 'mp4',
      description: '支援多種畫質選擇與 MP3 音樂分離',
      externalUrl: `https://www.y2mate.com/youtube/${videoId}`
    },
    {
      id: 'external-yt1s',
      label: 'YT1s 極速通道',
      type: 'video',
      quality: '高畫質 MP4',
      ext: 'mp4',
      description: '極速下載線路',
      externalUrl: `https://yt1s.com/en?q=${encodeURIComponent(url)}`
    }
  ];

  return {
    id: videoId,
    url,
    title,
    thumbnail,
    duration: 0,
    durationFormatted: 'Shorts',
    uploader,
    platform: 'youtube',
    isBotBlocked: true,
    embedUrl: `https://www.youtube.com/embed/${videoId}?autoplay=1`,
    formats,
    fallbacks: {
      ssyoutube: `https://www.ssyoutube.com/watch?v=${videoId}`,
      y2mate: `https://www.y2mate.com/youtube/${videoId}`,
      yt1s: `https://yt1s.com/en?q=${encodeURIComponent(url)}`
    }
  };
}

// 3. Direct Media Link
function parseDirectMedia(url: string) {
  const isAudio = url.match(/\.(mp3|m4a|aac)(\?.*)?$/i);
  const ext = isAudio ? 'mp3' : 'mp4';
  return {
    id: randomUUID(),
    url,
    title: '直接串流影音檔案',
    thumbnail: '',
    duration: 0,
    durationFormatted: '--:--',
    uploader: '網頁直接串流',
    platform: 'direct',
    directUrl: url,
    formats: [
      {
        id: `direct-${ext}`,
        label: isAudio ? 'MP3 音訊檔案' : 'MP4 影片檔案 (原始串流)',
        type: isAudio ? 'audio' : 'video',
        quality: '原始串流',
        ext,
        description: '直接由網頁伺服器下載',
        directUrl: url
      }
    ]
  };
}

// 4. Main Parse Endpoint
app.post('/api/parse', async (req, res) => {
  const { url, igSessionId, ytCookies } = req.body;
  if (!url || typeof url !== 'string' || !url.startsWith('http')) {
    return res.status(400).json({ error: '請輸入有效的網址 (需包含 http 或 https)' });
  }

  const platform = detectPlatform(url);

  // A. Dedicated TikTok parser
  if (platform === 'tiktok') {
    try {
      const tiktokData = await parseTikTok(url);
      return res.json(tiktokData);
    } catch (err: any) {
      console.warn('TikTok tikwm failed, falling back to yt-dlp:', err.message);
    }
  }

  // B. Direct Media Link
  if (platform === 'direct') {
    return res.json(parseDirectMedia(url));
  }

  // C. YouTube without custom cookies: Use instant oEmbed parser (50ms response, no bot blocks)
  if (platform === 'youtube' && (!ytCookies || !ytCookies.trim())) {
    const videoId = extractYouTubeId(url);
    if (videoId) {
      try {
        const oembedData = await parseYouTubeOEmbed(url, videoId);
        return res.json(oembedData);
      } catch (err: any) {
        console.warn('oEmbed parse failed, falling back:', err.message);
      }
    }
  }

  // D. General / Authenticated parser via yt-dlp
  const ytDlpPath = path.join(__dirname, 'bin', 'yt-dlp');
  if (!fs.existsSync(ytDlpPath)) {
    return res.status(500).json({ error: '解析核心尚未就緒，請稍後再試' });
  }
  try { fs.chmodSync(ytDlpPath, 0o755); } catch {}

  let hasResponded = false;
  const safeSend = (statusCode: number, payload: any) => {
    if (hasResponded || res.headersSent || res.writableEnded) return;
    hasResponded = true;
    res.status(statusCode).json(payload);
  };

  let cookieFile: string | null = null;
  const args = [
    '--js-runtimes', 'node:/usr/local/bin/node',
    '--dump-json',
    '--no-warnings',
    '--no-check-certificates',
    '--no-playlist'
  ];

  // If user provided Instagram session id
  if (platform === 'instagram' && igSessionId && typeof igSessionId === 'string' && igSessionId.trim()) {
    cookieFile = path.join(TEMP_DIR, `cookie_ig_${randomUUID()}.txt`);
    const val = igSessionId.trim();
    formatCookiesFile(val.includes('=') ? val : `sessionid=${val}`, 'instagram.com', cookieFile);
    args.push('--cookies', cookieFile);
  } else if (platform === 'youtube' && ytCookies && typeof ytCookies === 'string' && ytCookies.trim()) {
    // If user provided YouTube cookies
    cookieFile = path.join(TEMP_DIR, `cookie_yt_${randomUUID()}.txt`);
    formatCookiesFile(ytCookies, 'youtube.com', cookieFile);
    args.push('--cookies', cookieFile);
  }

  args.push(url);

  try {
    const child = spawn(ytDlpPath, args, {
      env: { ...process.env, PYTHONWARNINGS: 'ignore' }
    });
    let stdoutData = '';
    let stderrData = '';

    const timeout = setTimeout(() => {
      try {
        child.kill('SIGTERM');
      } catch { /* ignore */ }
    }, 25000);

    child.stdout.on('data', (chunk) => {
      stdoutData += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderrData += chunk.toString();
    });

    child.on('close', async (code) => {
      clearTimeout(timeout);
      if (cookieFile && fs.existsSync(cookieFile)) {
        try { fs.unlinkSync(cookieFile); } catch (e) { /* ignore */ }
      }

      if (hasResponded || res.headersSent || res.writableEnded) return;

      if (code !== 0 || !stdoutData.trim()) {
        // Special handling for YouTube bot protection without polluting stderr
        if (platform === 'youtube') {
          const videoId = extractYouTubeId(url);
          if (videoId) {
            try {
              const oembedData = await parseYouTubeOEmbed(url, videoId);
              return safeSend(200, oembedData);
            } catch {
              // fallback
            }
          }
        }

        // Special handling for Instagram anti-bot
        if (platform === 'instagram') {
          return safeSend(422, {
            error: 'Instagram 官方限制伺服器端存取。請使用下方的解鎖工具或免驗證備用專線。',
            platform: 'instagram',
            isInstagramBlocked: true,
            fallbackUrls: {
              snapinsta: `https://snapinsta.app/`,
              fastdl: `https://fastdl.app/`,
              saveig: `https://saveig.app/`
            }
          });
        }

        const friendlyMsg = stderrData.split('\n')
          .filter(l => l.includes('ERROR:'))
          .pop()
          ?.replace('ERROR:', '')
          .trim() || '無法擷取影片資訊，請確認影片網址是否公開或有效';

        return safeSend(422, {
          error: friendlyMsg,
          platform
        });
      }

      try {
        const data = JSON.parse(stdoutData.trim());
        const title = data.title || data.fulltitle || '未命名影片';
        const thumbnail = data.thumbnail || (data.thumbnails && data.thumbnails.length > 0 ? data.thumbnails[data.thumbnails.length - 1].url : '');
        const duration = data.duration || 0;
        const uploader = data.uploader || data.channel || data.creator || '創作者';
        const viewCount = data.view_count || null;
        const likeCount = data.like_count || null;

        const formats = [
          {
            id: 'mp4-best',
            label: 'MP4 高畫質 (原畫質 / 1080p)',
            type: 'video',
            quality: '1080p / 原畫質',
            ext: 'mp4',
            description: '最佳影像品質與立體聲'
          },
          {
            id: 'mp4-720p',
            label: 'MP4 標準畫質 (720p HD)',
            type: 'video',
            quality: '720p HD',
            ext: 'mp4',
            description: '平衡檔案大小與畫質'
          },
          {
            id: 'mp4-480p',
            label: 'MP4 輕量畫質 (480p SD)',
            type: 'video',
            quality: '480p SD',
            ext: 'mp4',
            description: '檔案體積小，下載快速'
          },
          {
            id: 'mp3',
            label: 'MP3 純音樂 (320kbps 音訊)',
            type: 'audio',
            quality: '320kbps 音訊',
            ext: 'mp3',
            description: '提取背景音樂或語音音軌'
          }
        ];

        let directUrl: string | null = null;
        if (data.url && typeof data.url === 'string' && data.url.startsWith('http')) {
          directUrl = data.url;
        }

        return safeSend(200, {
          id: data.id || randomUUID(),
          url,
          title,
          thumbnail,
          duration,
          durationFormatted: formatDuration(duration),
          uploader,
          platform,
          viewCount,
          likeCount,
          formats,
          directUrl
        });
      } catch (err: any) {
        return safeSend(500, { error: '解析影片資料格式失敗' });
      }
    });

    child.on('error', (err) => {
      clearTimeout(timeout);
      if (cookieFile && fs.existsSync(cookieFile)) {
        try { fs.unlinkSync(cookieFile); } catch (e) { /* ignore */ }
      }
      return safeSend(500, { error: '執行解析引擎時發生錯誤: ' + err.message });
    });
  } catch (err: any) {
    if (cookieFile && fs.existsSync(cookieFile)) {
      try { fs.unlinkSync(cookieFile); } catch (e) { /* ignore */ }
    }
    return safeSend(500, { error: err.message || '伺服器內部錯誤' });
  }
});

// 5. Start a download task
app.post('/api/download/start', async (req, res) => {
  const { url, formatId, title, directDownloadUrl, igSessionId, ytCookies } = req.body;
  if (!url && !directDownloadUrl) {
    return res.status(400).json({ error: '缺少影片下載網址' });
  }

  const taskId = randomUUID();
  const safeTitle = (title || 'video').replace(/[/\\?%*:|"<>]/g, '_').substring(0, 60);
  const isAudio = formatId === 'mp3' || formatId === 'tiktok-audio' || formatId === 'direct-mp3';
  const ext = isAudio ? 'mp3' : 'mp4';
  const outPath = path.join(DOWNLOADS_DIR, `${taskId}.${ext}`);

  const task: DownloadTask = {
    id: taskId,
    url: directDownloadUrl || url,
    title: safeTitle,
    format: formatId || 'mp4-best',
    ext,
    status: 'downloading',
    progress: 10,
    createdAt: Date.now()
  };
  tasks.set(taskId, task);

  // If we have a direct download URL (from TikTok or direct stream)
  if (directDownloadUrl && typeof directDownloadUrl === 'string' && directDownloadUrl.startsWith('http')) {
    (async () => {
      try {
        const fileRes = await fetch(directDownloadUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://www.tiktok.com/'
          }
        });

        if (!fileRes.ok || !fileRes.body) {
          throw new Error(`遠端串流伺服器回傳狀態碼 ${fileRes.status}`);
        }

        const contentLength = Number(fileRes.headers.get('content-length')) || 0;
        const fileStream = fs.createWriteStream(outPath);

        let downloadedBytes = 0;
        const reader = fileRes.body.getReader();

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            fileStream.write(Buffer.from(value));
            downloadedBytes += value.length;
            if (contentLength > 0) {
              const p = Math.round((downloadedBytes / contentLength) * 100);
              task.progress = Math.min(99, Math.max(task.progress, p));
            } else {
              task.progress = Math.min(95, task.progress + 5);
            }
          }
        }

        fileStream.end();

        task.status = 'completed';
        task.progress = 100;
        task.filePath = outPath;
        try {
          const stats = fs.statSync(outPath);
          task.fileSize = (stats.size / (1024 * 1024)).toFixed(2) + ' MB';
        } catch { /* ignore */ }
      } catch (err: any) {
        console.error('Direct stream download error:', err);
        task.status = 'error';
        task.error = '直接串流下載失敗: ' + err.message;
      }
    })();

    return res.json({ taskId });
  }

  // Otherwise, use yt-dlp to download and convert
  const ytDlpPath = path.join(__dirname, 'bin', 'yt-dlp');
  try { fs.chmodSync(ytDlpPath, 0o755); } catch {}
  let formatArg = 'b/best';
  if (formatId === 'mp4-best') {
    formatArg = 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/b/best';
  } else if (formatId === 'mp4-720p') {
    formatArg = 'bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720]/b/best';
  } else if (formatId === 'mp4-480p') {
    formatArg = 'bestvideo[height<=480][ext=mp4]+bestaudio[ext=m4a]/best[height<=480]/b/best';
  }

  let cookieFile: string | null = null;
  const args = [
    '--js-runtimes', 'node:/usr/local/bin/node',
    '--no-check-certificates',
    '--no-playlist',
    '--newline'
  ];

  if (igSessionId && typeof igSessionId === 'string' && igSessionId.trim()) {
    cookieFile = path.join(TEMP_DIR, `cookie_ig_${taskId}.txt`);
    const val = igSessionId.trim();
    formatCookiesFile(val.includes('=') ? val : `sessionid=${val}`, 'instagram.com', cookieFile);
    args.push('--cookies', cookieFile);
  } else if (ytCookies && typeof ytCookies === 'string' && ytCookies.trim()) {
    cookieFile = path.join(TEMP_DIR, `cookie_yt_${taskId}.txt`);
    formatCookiesFile(ytCookies, 'youtube.com', cookieFile);
    args.push('--cookies', cookieFile);
  }

  if (isAudio) {
    args.push('-x', '--audio-format', 'mp3', '--audio-quality', '0', '-o', outPath, url);
  } else {
    args.push('-f', formatArg, '--merge-output-format', 'mp4', '-o', outPath, url);
  }

  try {
    const child = spawn(ytDlpPath, args, {
      env: { ...process.env, PYTHONWARNINGS: 'ignore' }
    });

    child.stdout.on('data', (chunk) => {
      const line = chunk.toString();
      const percentMatch = line.match(/(\d+(?:\.\d+)?)%/);
      if (percentMatch) {
        task.progress = Math.min(99, Math.max(task.progress, parseFloat(percentMatch[1])));
      }
      const speedMatch = line.match(/at\s+([\d.]+\s*\w+\/s)/i);
      if (speedMatch) {
        task.speed = speedMatch[1];
      }
      const etaMatch = line.match(/ETA\s+([\d:]+)/i);
      if (etaMatch) {
        task.eta = etaMatch[1];
      }
    });

    child.stderr.on('data', (chunk) => {
      const errLine = chunk.toString();
      if (errLine.includes('ERROR:')) {
        task.error = errLine.replace('ERROR:', '').trim();
      }
    });

    child.on('close', (code) => {
      if (cookieFile && fs.existsSync(cookieFile)) {
        try { fs.unlinkSync(cookieFile); } catch { /* ignore */ }
      }

      if (code === 0 && fs.existsSync(outPath)) {
        task.status = 'completed';
        task.progress = 100;
        task.filePath = outPath;
        try {
          const stats = fs.statSync(outPath);
          task.fileSize = (stats.size / (1024 * 1024)).toFixed(2) + ' MB';
        } catch { /* ignore */ }
      } else {
        task.status = 'error';
        if (!task.error) {
          task.error = '影片下載轉換失敗，請更換畫質或確認來源';
        }
      }
    });

    child.on('error', (err) => {
      if (cookieFile && fs.existsSync(cookieFile)) {
        try { fs.unlinkSync(cookieFile); } catch { /* ignore */ }
      }
      task.status = 'error';
      task.error = err.message;
    });

    return res.json({ taskId });
  } catch (err: any) {
    if (cookieFile && fs.existsSync(cookieFile)) {
      try { fs.unlinkSync(cookieFile); } catch { /* ignore */ }
    }
    task.status = 'error';
    task.error = err.message;
    return res.status(500).json({ error: '無法啟動下載程序' });
  }
});

// 6. Check download task status
app.get('/api/download/status/:id', (req, res) => {
  const task = tasks.get(req.params.id);
  if (!task) {
    return res.status(404).json({ error: '下載任務不存在或已過期' });
  }
  return res.json({
    id: task.id,
    status: task.status,
    progress: task.progress,
    speed: task.speed,
    eta: task.eta,
    fileSize: task.fileSize,
    ext: task.ext,
    title: task.title,
    error: task.error
  });
});

// 7. Download file endpoint
app.get('/api/download/file/:id', (req, res) => {
  const task = tasks.get(req.params.id);
  if (!task || !task.filePath || !fs.existsSync(task.filePath)) {
    return res.status(404).send('檔案不存在或已被清理');
  }

  const encodedFilename = encodeURIComponent(`${task.title}.${task.ext}`);
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodedFilename}`);
  res.setHeader('Content-Type', task.ext === 'mp3' ? 'audio/mpeg' : 'video/mp4');

  const fileStream = fs.createReadStream(task.filePath);
  fileStream.pipe(res);
});

async function startServer() {
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Video Downloader Server running at http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
});
