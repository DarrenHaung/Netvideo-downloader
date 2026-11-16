import React, { useState, useEffect, useRef } from 'react';
import {
  Youtube,
  Instagram,
  Video,
  Music,
  Download,
  CheckCircle2,
  AlertCircle,
  Clock,
  ExternalLink,
  Copy,
  Trash2,
  Play,
  X,
  Sparkles,
  Clipboard,
  Loader2,
  ShieldCheck,
  FileVideo,
  ArrowRight,
  KeyRound,
  Compass,
  HelpCircle,
  Check,
  ChevronDown,
  ChevronUp
} from 'lucide-react';

interface FormatOption {
  id: string;
  label: string;
  type: 'video' | 'audio';
  quality: string;
  ext: string;
  description: string;
  directUrl?: string;
}

interface VideoData {
  id: string;
  url: string;
  title: string;
  thumbnail: string;
  duration: number;
  durationFormatted: string;
  uploader: string;
  platform: 'youtube' | 'instagram' | 'tiktok' | 'facebook' | 'direct' | 'general';
  viewCount?: number | null;
  likeCount?: number | null;
  formats: FormatOption[];
  directUrl?: string | null;
}

interface PresetItem {
  platform: string;
  platformName: string;
  title: string;
  url: string;
  description: string;
}

interface HistoryItem {
  id: string;
  title: string;
  url: string;
  thumbnail: string;
  platform: string;
  timestamp: number;
  format: string;
}

export default function App() {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isIgBlocked, setIsIgBlocked] = useState(false);
  const [videoData, setVideoData] = useState<VideoData | null>(null);
  const [selectedFormat, setSelectedFormat] = useState<string>('mp4-best');
  const [previewOpen, setPreviewOpen] = useState(false);
  
  // Settings & IG/YT Session
  const [showSettings, setShowSettings] = useState(false);
  const [activeSettingsTab, setActiveSettingsTab] = useState<'youtube' | 'instagram'>('youtube');
  const [igSessionId, setIgSessionId] = useState<string>(() => {
    return localStorage.getItem('reelvault_ig_session') || '';
  });
  const [ytCookies, setYtCookies] = useState<string>(() => {
    return localStorage.getItem('reelvault_yt_cookies') || '';
  });
  const [savedCookieSuccess, setSavedCookieSuccess] = useState(false);
  const [savedYtCookieSuccess, setSavedYtCookieSuccess] = useState(false);
  const [copiedBookmarklet, setCopiedBookmarklet] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);

  // Presets
  const [presets, setPresets] = useState<PresetItem[]>([]);
  
  // Download progress state
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<number>(0);
  const [downloadSpeed, setDownloadSpeed] = useState<string>('');
  const [downloadEta, setDownloadEta] = useState<string>('');
  const [downloadStatus, setDownloadStatus] = useState<'idle' | 'downloading' | 'completed' | 'error'>('idle');
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloadFileSize, setDownloadFileSize] = useState<string>('');

  // History
  const [history, setHistory] = useState<HistoryItem[]>(() => {
    try {
      const saved = localStorage.getItem('reelvault_history');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const pollIntervalRef = useRef<number | null>(null);

  // Check URL params on mount (e.g. from bookmarklet)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const targetUrl = params.get('url') || params.get('direct');
    if (targetUrl) {
      setUrl(targetUrl);
      handleParse(targetUrl);
    }
  }, []);

  // Fetch presets on load
  useEffect(() => {
    fetch('/api/presets')
      .then((res) => res.json())
      .then((data) => {
        if (data.presets) {
          setPresets(data.presets);
        }
      })
      .catch((err) => console.error('Presets error:', err));
  }, []);

  // Sync history
  useEffect(() => {
    try {
      localStorage.setItem('reelvault_history', JSON.stringify(history));
    } catch (e) {
      console.error(e);
    }
  }, [history]);

  // Clean polling on unmount
  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, []);

  // Save IG Session ID
  const handleSaveIgSession = () => {
    localStorage.setItem('reelvault_ig_session', igSessionId.trim());
    setSavedCookieSuccess(true);
    setTimeout(() => setSavedCookieSuccess(false), 2500);
    if (url.includes('instagram.com')) {
      handleParse();
    }
  };

  // Save YouTube Cookies
  const handleSaveYtCookies = () => {
    localStorage.setItem('reelvault_yt_cookies', ytCookies.trim());
    setSavedYtCookieSuccess(true);
    setTimeout(() => setSavedYtCookieSuccess(false), 2500);
    if (url.includes('youtube.com') || url.includes('youtu.be')) {
      handleParse();
    }
  };

  // Detect platform by URL
  const detectedPlatform = React.useMemo(() => {
    const l = url.toLowerCase();
    if (l.includes('youtube.com') || l.includes('youtu.be')) return 'youtube';
    if (l.includes('instagram.com')) return 'instagram';
    if (l.includes('tiktok.com')) return 'tiktok';
    if (l.match(/\.(mp4|mov|webm)(\?.*)?$/i) || l.includes('cdninstagram.com') || l.includes('tiktokcdn')) return 'direct';
    return 'unknown';
  }, [url]);

  const handleParse = async (targetUrl?: string) => {
    const urlToParse = (targetUrl || url).trim();
    if (!urlToParse) {
      setError('請先輸入或貼上影片網址');
      return;
    }

    setLoading(true);
    setError(null);
    setIsIgBlocked(false);
    setVideoData(null);
    setDownloadStatus('idle');

    try {
      const res = await fetch('/api/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: urlToParse,
          igSessionId: igSessionId.trim(),
          ytCookies: ytCookies.trim()
        })
      });

      const data = await res.json();
      if (!res.ok) {
        if (data.isInstagramBlocked) {
          setIsIgBlocked(true);
        }
        throw new Error(data.error || '解析失敗，請確認網址格式或該影片是否公開');
      }

      setVideoData(data);
      if (data.formats && data.formats.length > 0) {
        setSelectedFormat(data.formats[0].id);
      }
    } catch (err: any) {
      setError(err.message || '網路連線異常，請稍後再試');
    } finally {
      setLoading(false);
    }
  };

  const handlePasteClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setUrl(text);
        handleParse(text);
      }
    } catch {
      setError('請手動在文字框內貼上 (Ctrl+V 或 Command+V)');
    }
  };

  const handleStartDownload = async () => {
    if (!videoData) return;

    // Check if the selected format has an external bypass URL (e.g. for YouTube bot protection)
    const currentFmt = videoData.formats.find(f => f.id === selectedFormat);
    if (currentFmt && (currentFmt as any).externalUrl) {
      window.open((currentFmt as any).externalUrl, '_blank');
      setDownloadStatus('completed');
      setDownloadFileSize('免驗證通道已於新分頁開啟');
      return;
    }

    setDownloadStatus('downloading');
    setDownloadProgress(8);
    setDownloadSpeed('');
    setDownloadEta('');
    setDownloadError(null);

    const directDownloadUrl = currentFmt?.directUrl || videoData.directUrl;

    try {
      const res = await fetch('/api/download/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: videoData.url,
          formatId: selectedFormat,
          title: videoData.title,
          directDownloadUrl: directDownloadUrl || undefined,
          igSessionId: igSessionId.trim(),
          ytCookies: ytCookies.trim()
        })
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || '啟動下載程序失敗');
      }

      const taskId = data.taskId;
      setActiveTaskId(taskId);

      // Start polling status
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);

      pollIntervalRef.current = window.setInterval(async () => {
        try {
          const statusRes = await fetch(`/api/download/status/${taskId}`);
          if (!statusRes.ok) return;

          const statusData = await statusRes.json();
          setDownloadProgress(statusData.progress || 0);
          if (statusData.speed) setDownloadSpeed(statusData.speed);
          if (statusData.eta) setDownloadEta(statusData.eta);
          if (statusData.fileSize) setDownloadFileSize(statusData.fileSize);

          if (statusData.status === 'completed') {
            if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
            setDownloadStatus('completed');
            setDownloadProgress(100);

            // Add to history
            const newHistoryItem: HistoryItem = {
              id: taskId,
              title: videoData.title,
              url: videoData.url,
              thumbnail: videoData.thumbnail,
              platform: videoData.platform,
              timestamp: Date.now(),
              format: selectedFormat
            };
            setHistory((prev) => [newHistoryItem, ...prev.slice(0, 19)]);

            // Trigger browser download via invisible link
            const downloadUrl = `/api/download/file/${taskId}`;
            const link = document.createElement('a');
            link.href = downloadUrl;
            link.setAttribute('download', `${videoData.title}.${selectedFormat.includes('audio') || selectedFormat === 'mp3' ? 'mp3' : 'mp4'}`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
          } else if (statusData.status === 'error') {
            if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
            setDownloadStatus('error');
            setDownloadError(statusData.error || '下載處理失敗');
          }
        } catch (e: any) {
          console.error('Polling error:', e);
        }
      }, 1000);
    } catch (err: any) {
      setDownloadStatus('error');
      setDownloadError(err.message || '無法下載影片');
    }
  };

  const getPlatformIcon = (platform: string, sizeClass = 'w-5 h-5') => {
    switch (platform) {
      case 'youtube':
        return <Youtube className={`${sizeClass} text-red-600`} />;
      case 'instagram':
        return <Instagram className={`${sizeClass} text-pink-600`} />;
      case 'tiktok':
        return <Video className={`${sizeClass} text-cyan-600`} />;
      default:
        return <FileVideo className={`${sizeClass} text-slate-600`} />;
    }
  };

  const getPlatformName = (platform: string) => {
    switch (platform) {
      case 'youtube':
        return 'YouTube Shorts';
      case 'instagram':
        return 'Instagram Reel';
      case 'tiktok':
        return 'TikTok';
      case 'direct':
        return '直接串流';
      default:
        return '短影音平台';
    }
  };

  const clearHistory = () => {
    setHistory([]);
    localStorage.removeItem('reelvault_history');
  };

  const copyCurrentUrl = () => {
    if (url) {
      navigator.clipboard.writeText(url);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2000);
    }
  };

  // Bookmarklet code that extracts current playing video in user's browser
  const bookmarkletCode = `javascript:(function(){const v=document.querySelector('video');if(v&&v.src){const appUrl=window.location.origin.includes('run.app')?window.location.origin:'${window.location.origin}';window.open(appUrl+'/?url='+encodeURIComponent(v.src)+'&title='+encodeURIComponent(document.title));}else{alert('請先在Instagram頁面點開該Reel播放');}})();`;

  const copyBookmarklet = () => {
    navigator.clipboard.writeText(bookmarkletCode);
    setCopiedBookmarklet(true);
    setTimeout(() => setCopiedBookmarklet(false), 2500);
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-sans">
      {/* Top Bar Contract (3 zones) */}
      <header className="flex items-center justify-between gap-8 px-6 lg:px-12 py-4 bg-white border-b border-slate-200 sticky top-0 z-40">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-slate-900 text-white flex items-center justify-center font-bold text-sm shadow-sm">
            RV
          </div>
          <span className="text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0">
            ReelVault 影音下載器
          </span>
        </div>

        <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-slate-600">
          <span className="flex items-center gap-1.5 text-slate-800 font-semibold whitespace-nowrap">
            <Youtube className="w-4 h-4 text-red-600" /> YouTube Shorts
          </span>
          <span className="flex items-center gap-1.5 text-slate-800 font-semibold whitespace-nowrap">
            <Instagram className="w-4 h-4 text-pink-600" /> Instagram Reels
          </span>
          <span className="flex items-center gap-1.5 text-slate-800 font-semibold whitespace-nowrap">
            <Video className="w-4 h-4 text-cyan-600" /> TikTok (免浮水印)
          </span>
        </nav>

        <div className="flex items-center gap-3 shrink-0">
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="px-3.5 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5"
          >
            <KeyRound className="w-3.5 h-3.5 text-slate-600" />
            <span>解鎖站內直下 (Cookie)</span>
          </button>

          <button
            onClick={() => {
              const el = document.getElementById('history-section');
              el?.scrollIntoView({ behavior: 'smooth' });
            }}
            className="px-3.5 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors whitespace-nowrap shrink-0 flex items-center gap-1.5"
          >
            <Clock className="w-3.5 h-3.5" /> 下載紀錄 ({history.length})
          </button>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 lg:py-12 space-y-8">
        {/* Hero Section */}
        <div className="text-center space-y-3 max-w-2xl mx-auto">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-200/70 text-slate-700 text-xs font-medium">
            <Sparkles className="w-3.5 h-3.5 text-amber-500" />
            <span>TikTok 支援 100% 站內直下（無浮水印）· 支援 YouTube & IG Cookie 解鎖</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-slate-900">
            貼上連結，一鍵快速下載短影音
          </h1>
          <p className="text-slate-600 text-sm sm:text-base leading-relaxed">
            無廣告干擾、無繁瑣跳轉。只需複製短片網址貼上，即可直接預覽並下載高品質影片或提取音樂檔。
          </p>
        </div>

        {/* Cookie / Direct Download Config Panel (Collapsible) */}
        {showSettings && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-5 space-y-4 transition-all">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-slate-900" />
                <h3 className="text-sm font-bold text-slate-900">站內直接下載解鎖設定（Cookie）</h3>
              </div>
              <button
                onClick={() => setShowSettings(false)}
                className="text-slate-400 hover:text-slate-600 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Tab switch */}
            <div className="flex gap-2 border-b border-slate-100 pb-2">
              <button
                type="button"
                onClick={() => setActiveSettingsTab('youtube')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors ${
                  activeSettingsTab === 'youtube'
                    ? 'bg-red-50 text-red-700 border border-red-200'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                <Youtube className="w-3.5 h-3.5 text-red-600" />
                <span>YouTube 站內直接下載</span>
              </button>
              <button
                type="button"
                onClick={() => setActiveSettingsTab('instagram')}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-colors ${
                  activeSettingsTab === 'instagram'
                    ? 'bg-pink-50 text-pink-700 border border-pink-200'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                <Instagram className="w-3.5 h-3.5 text-pink-600" />
                <span>Instagram 站內直接下載</span>
              </button>
            </div>

            {/* YouTube Settings Tab */}
            {activeSettingsTab === 'youtube' && (
              <div className="space-y-3">
                <p className="text-xs text-slate-600 leading-relaxed">
                  <strong>為什麼 YouTube Shorts 會要求專線？</strong> YouTube 官方全面封鎖了雲端伺服器（Google Cloud Run）的匿名下載請求（提示「Sign in to confirm you're not a bot」）。若您希望<strong>像 TikTok 一樣點擊「下載」直接在站內下載 MP4/MP3 至本機、絕不跳轉外部網站</strong>，只需在此貼上 YouTube 的登入 Cookie，伺服器即可模擬真實瀏覽器直接抓取下載！
                </p>

                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    value={ytCookies}
                    onChange={(e) => setYtCookies(e.target.value)}
                    placeholder="貼上 YouTube Cookie 字串 (例如: SID=...; LOGIN_INFO=... 或 Netscape 格式)"
                    className="flex-1 px-3.5 py-2 text-xs bg-slate-50 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 focus:bg-white font-mono"
                  />
                  <button
                    onClick={handleSaveYtCookies}
                    className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-xl transition-colors whitespace-nowrap shrink-0 flex items-center justify-center gap-1.5"
                  >
                    {savedYtCookieSuccess ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        <span>已儲存！已解鎖直下</span>
                      </>
                    ) : (
                      <span>儲存 YouTube Cookie</span>
                    )}
                  </button>
                </div>

                <div className="bg-slate-50 rounded-xl p-3 text-[11px] text-slate-500 space-y-1">
                  <p className="font-semibold text-slate-700">💡 如何取得 YouTube Cookie？（只需 20 秒）</p>
                  <ol className="list-decimal pl-4 space-y-0.5">
                    <li>在電腦瀏覽器登入 YouTube。</li>
                    <li>安裝並點擊 Chrome/Edge 擴充功能 <span className="font-medium text-slate-700">"Get cookies.txt LOCALLY"</span> 複製全部內容。</li>
                    <li>或按下 <kbd className="bg-white border px-1 rounded">F12</kbd> ➔ 切換至 <span className="font-medium text-slate-700">網路 (Network)</span> ➔ 點選任意 youtube.com 請求 ➔ 複製請求標頭中的 <span className="font-mono text-slate-800 font-semibold">Cookie</span> 數值貼於此處。</li>
                  </ol>
                </div>
              </div>
            )}

            {/* Instagram Settings Tab */}
            {activeSettingsTab === 'instagram' && (
              <div className="space-y-3">
                <p className="text-xs text-slate-600 leading-relaxed">
                  Instagram 近期加強雲端防爬蟲限制，未登入的伺服器會被要求驗證。若您需要大量直接在站內下載 Instagram Reels，只需在此貼上您瀏覽器的 <code className="bg-slate-100 px-1 py-0.5 rounded font-mono text-pink-600">sessionid</code>，即可解除所有限制！
                </p>

                <div className="flex flex-col sm:flex-row gap-2">
                  <input
                    type="text"
                    value={igSessionId}
                    onChange={(e) => setIgSessionId(e.target.value)}
                    placeholder="貼上 Instagram sessionid (例如: 12345678%3Abcd...)"
                    className="flex-1 px-3.5 py-2 text-xs bg-slate-50 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 focus:bg-white font-mono"
                  />
                  <button
                    onClick={handleSaveIgSession}
                    className="px-4 py-2 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-xl transition-colors whitespace-nowrap shrink-0 flex items-center justify-center gap-1.5"
                  >
                    {savedCookieSuccess ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        <span>已儲存！</span>
                      </>
                    ) : (
                      <span>儲存 IG 設定</span>
                    )}
                  </button>
                </div>

                <div className="bg-slate-50 rounded-xl p-3 text-[11px] text-slate-500 space-y-1">
                  <p className="font-semibold text-slate-700">💡 如何取得 sessionid？（只需 20 秒）</p>
                  <ol className="list-decimal pl-4 space-y-0.5">
                    <li>在電腦 Chrome / Edge 瀏覽器開啟並登入 Instagram 網站。</li>
                    <li>按下鍵盤 <kbd className="bg-white border px-1 rounded">F12</kbd> 開啟「開發人員工具」並切換至 <span className="font-medium text-slate-700">Application (應用程式)</span>。</li>
                    <li>左側展開 <span className="font-medium text-slate-700">Cookies</span> -&gt; 點選 <span className="font-medium text-slate-700">https://www.instagram.com</span>。</li>
                    <li>找到名為 <span className="font-mono text-pink-600 font-semibold">sessionid</span> 的項目，雙擊複製其值貼到此處儲存即可。</li>
                  </ol>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Input Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4 sm:p-6 space-y-4">
          <div className="relative flex flex-col sm:flex-row items-stretch gap-2.5">
            <div className="relative flex-1 flex items-center">
              <div className="absolute left-3.5 pointer-events-none text-slate-400">
                {detectedPlatform === 'youtube' && <Youtube className="w-5 h-5 text-red-600" />}
                {detectedPlatform === 'instagram' && <Instagram className="w-5 h-5 text-pink-600" />}
                {detectedPlatform === 'tiktok' && <Video className="w-5 h-5 text-cyan-600" />}
                {detectedPlatform === 'direct' && <Sparkles className="w-5 h-5 text-emerald-600" />}
                {detectedPlatform === 'unknown' && <FileVideo className="w-5 h-5 text-slate-400" />}
              </div>
              <input
                type="text"
                value={url}
                onChange={(e) => {
                  setUrl(e.target.value);
                  if (error) setError(null);
                  if (isIgBlocked) setIsIgBlocked(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleParse();
                }}
                placeholder="貼上 YouTube Shorts、Instagram Reel 或 TikTok 影片網址..."
                className="w-full pl-11 pr-20 py-3.5 text-sm sm:text-base bg-slate-50 border border-slate-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-slate-900 focus:bg-white transition-all text-slate-900 placeholder:text-slate-400"
              />
              {url && (
                <button
                  onClick={() => {
                    setUrl('');
                    setVideoData(null);
                    setError(null);
                    setIsIgBlocked(false);
                  }}
                  className="absolute right-3 p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-200 transition-colors"
                  title="清除"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handlePasteClipboard}
                className="px-4 py-3.5 text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
                title="從剪貼簿貼上網址"
              >
                <Clipboard className="w-4 h-4 text-slate-500" />
                <span className="hidden sm:inline">貼上</span>
              </button>

              <button
                type="button"
                onClick={() => handleParse()}
                disabled={loading || !url.trim()}
                className="flex-1 sm:flex-initial px-6 py-3.5 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:bg-slate-300 disabled:cursor-not-allowed rounded-xl transition-all shadow-sm flex items-center justify-center gap-2 whitespace-nowrap shrink-0"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>解析中...</span>
                  </>
                ) : (
                  <>
                    <span>開始解析</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Quick Presets row */}
          {presets.length > 0 && (
            <div className="pt-2 border-t border-slate-100 flex flex-wrap items-center gap-2 text-xs">
              <span className="text-slate-500 font-medium whitespace-nowrap">🔥 100% 可用範例測試：</span>
              {presets.map((preset, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => {
                    setUrl(preset.url);
                    handleParse(preset.url);
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 font-medium transition-colors"
                >
                  {getPlatformIcon(preset.platform, 'w-3.5 h-3.5')}
                  <span>{preset.title}</span>
                </button>
              ))}
            </div>
          )}

          {/* Instagram Anti-Bot Solution Box (Crucial for the user's question) */}
          {(isIgBlocked || (error && error.includes('防爬蟲限制'))) && (
            <div className="p-5 rounded-2xl bg-amber-50/90 border border-amber-300 text-slate-800 space-y-4">
              <div className="flex items-start gap-3">
                <AlertCircle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <h4 className="text-sm font-bold text-amber-900">
                    遇到 Instagram 登入或防爬蟲限制？請參考以下 3 種立即解決方案：
                  </h4>
                  <p className="text-xs text-amber-800 leading-relaxed">
                    Instagram 為了防止未授權下載，會自動封鎖雲端伺服器的未登入匿名請求。請選擇最適合您的一種方式：
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-1">
                {/* Solution 1: 1-Click External Fallbacks */}
                <div className="bg-white rounded-xl p-3.5 border border-amber-200 flex flex-col justify-between space-y-3 shadow-xs">
                  <div className="space-y-1">
                    <span className="text-[11px] font-bold text-amber-700 uppercase tracking-wide">
                      捷徑 1 · 最快免設定
                    </span>
                    <h5 className="text-xs font-bold text-slate-900">
                      一鍵複製並開啟備用解析站
                    </h5>
                    <p className="text-[11px] text-slate-500 leading-relaxed">
                      已為您自動備好當前網址，點擊按鈕直接開啟外部免費解析站貼上下載。
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <a
                      href={`https://snapinsta.app/`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={copyCurrentUrl}
                      className="w-full py-2 px-3 rounded-lg bg-slate-900 text-white text-xs font-semibold hover:bg-slate-800 transition-colors flex items-center justify-center gap-1.5"
                    >
                      <span>前往 SnapInsta</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                    <a
                      href={`https://fastdl.app/`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={copyCurrentUrl}
                      className="w-full py-1.5 px-3 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium transition-colors flex items-center justify-center gap-1.5"
                    >
                      <span>前往 FastDL 備用</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </div>
                </div>

                {/* Solution 2: Browser Bookmarklet */}
                <div className="bg-white rounded-xl p-3.5 border border-amber-200 flex flex-col justify-between space-y-3 shadow-xs">
                  <div className="space-y-1">
                    <span className="text-[11px] font-bold text-indigo-700 uppercase tracking-wide">
                      捷徑 2 · 免登入免密碼
                    </span>
                    <h5 className="text-xs font-bold text-slate-900">
                      瀏覽器一鍵提取書籤腳本
                    </h5>
                    <p className="text-[11px] text-slate-500 leading-relaxed">
                      在觀看任何 IG Reel 時點一下書籤，直接提取瀏覽器正在播放的高畫質串流影片。
                    </p>
                  </div>
                  <button
                    onClick={copyBookmarklet}
                    className="w-full py-2 px-3 rounded-lg bg-indigo-50 border border-indigo-200 text-indigo-700 text-xs font-semibold hover:bg-indigo-100 transition-colors flex items-center justify-center gap-1.5"
                  >
                    {copiedBookmarklet ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                        <span>已複製書籤代碼！</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>複製書籤腳本代碼</span>
                      </>
                    )}
                  </button>
                </div>

                {/* Solution 3: Session ID config */}
                <div className="bg-white rounded-xl p-3.5 border border-amber-200 flex flex-col justify-between space-y-3 shadow-xs">
                  <div className="space-y-1">
                    <span className="text-[11px] font-bold text-pink-700 uppercase tracking-wide">
                      捷徑 3 · 徹底解除限制
                    </span>
                    <h5 className="text-xs font-bold text-slate-900">
                      設定 IG sessionid
                    </h5>
                    <p className="text-[11px] text-slate-500 leading-relaxed">
                      填入您的瀏覽器 sessionid，永久在 ReelVault 內直接下載所有公開與私密 Reels。
                    </p>
                  </div>
                  <button
                    onClick={() => setShowSettings(true)}
                    className="w-full py-2 px-3 rounded-lg bg-pink-50 border border-pink-200 text-pink-700 text-xs font-semibold hover:bg-pink-100 transition-colors flex items-center justify-center gap-1.5"
                  >
                    <KeyRound className="w-3.5 h-3.5" />
                    <span>開啟 IG Cookie 設定</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* General Error Message (if not IG anti-bot) */}
          {error && !isIgBlocked && !error.includes('防爬蟲限制') && (
            <div className="p-4 rounded-xl bg-red-50 border border-red-200 text-red-700 text-sm flex items-start gap-3">
              <AlertCircle className="w-5 h-5 shrink-0 mt-0.5 text-red-500" />
              <div className="space-y-1">
                <p className="font-semibold">解析失敗</p>
                <p className="text-xs text-red-600 leading-relaxed">{error}</p>
                <p className="text-xs text-slate-500 pt-1">
                  💡 提示：可點擊上方「100% 可用範例測試」確認下載器各項功能正常運作。
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Parsed Video Result Card */}
        {videoData && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden transition-all">
            <div className="p-6 grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
              {/* Thumbnail & Preview */}
              <div className="md:col-span-5 relative group rounded-xl overflow-hidden bg-slate-900 aspect-[9/16] max-h-[360px] mx-auto w-full max-w-[240px] flex items-center justify-center shadow-inner">
                {videoData.thumbnail ? (
                  <img
                    src={videoData.thumbnail}
                    alt={videoData.title}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="text-slate-500 flex flex-col items-center gap-2">
                    <FileVideo className="w-12 h-12 stroke-[1.5]" />
                    <span className="text-xs">短影音縮圖</span>
                  </div>
                )}

                {/* Duration badge */}
                {videoData.durationFormatted && (
                  <div className="absolute bottom-3 right-3 bg-black/75 text-white px-2 py-0.5 rounded text-xs font-mono font-medium backdrop-blur-sm">
                    {videoData.durationFormatted}
                  </div>
                )}

                {/* Platform Badge */}
                <div className="absolute top-3 left-3 bg-white/90 text-slate-800 px-2 py-1 rounded-md text-xs font-semibold backdrop-blur-sm flex items-center gap-1.5 shadow-sm">
                  {getPlatformIcon(videoData.platform, 'w-3.5 h-3.5')}
                  <span>{getPlatformName(videoData.platform)}</span>
                </div>

                {/* Play preview overlay */}
                {(videoData.directUrl || (videoData as any).embedUrl) && (
                  <button
                    onClick={() => setPreviewOpen(true)}
                    className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white"
                  >
                    <div className="w-12 h-12 rounded-full bg-white/90 text-slate-900 flex items-center justify-center shadow-lg">
                      <Play className="w-5 h-5 ml-0.5 fill-current" />
                    </div>
                  </button>
                )}
              </div>

              {/* Info & Options */}
              <div className="md:col-span-7 flex flex-col justify-between space-y-5">
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-xs text-slate-500">
                    <span className="font-medium text-slate-700">{videoData.uploader}</span>
                    <span>·</span>
                    <span>{getPlatformName(videoData.platform)}</span>
                  </div>

                  <h2 className="text-lg sm:text-xl font-bold text-slate-900 leading-snug line-clamp-3">
                    {videoData.title}
                  </h2>

                  {(videoData as any).isBotBlocked && (
                    <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="flex items-center gap-1.5 font-bold text-amber-900">
                          <Sparkles className="w-4 h-4 text-amber-600 shrink-0" />
                          免驗證專線下載中（防機器人機制）
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            setActiveSettingsTab('youtube');
                            setShowSettings(true);
                          }}
                          className="px-2 py-0.5 rounded bg-amber-600 hover:bg-amber-700 text-white font-medium text-[11px] transition-colors"
                        >
                          想在站內直下？點此解鎖
                        </button>
                      </div>
                      <p className="text-[11px] text-amber-800 leading-relaxed">
                        YouTube 近期全面封鎖了雲端伺服器匿名抓取。點擊下方下載即可開啟專線快速儲存；若您想<strong>直接在本站內一鍵下載（不開新分頁）</strong>，填入 YouTube Cookie 即可永久解鎖！
                      </p>
                    </div>
                  )}
                </div>

                {/* Format Selection */}
                <div className="space-y-2.5">
                  <label className="text-xs font-bold uppercase tracking-wider text-slate-500">
                    選擇下載格式與畫質
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {videoData.formats.map((fmt) => (
                      <button
                        key={fmt.id}
                        type="button"
                        onClick={() => setSelectedFormat(fmt.id)}
                        className={`text-left p-3 rounded-xl border transition-all flex items-start gap-3 ${
                          selectedFormat === fmt.id
                            ? 'border-slate-900 bg-slate-50 ring-1 ring-slate-900'
                            : 'border-slate-200 hover:border-slate-300 bg-white'
                        }`}
                      >
                        <div
                          className={`p-2 rounded-lg mt-0.5 ${
                            fmt.type === 'audio'
                              ? 'bg-purple-100 text-purple-700'
                              : 'bg-blue-100 text-blue-700'
                          }`}
                        >
                          {fmt.type === 'audio' ? (
                            <Music className="w-4 h-4" />
                          ) : (
                            <Video className="w-4 h-4" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-xs font-bold text-slate-900 truncate">
                            {fmt.label}
                          </div>
                          <div className="text-[11px] text-slate-500 mt-0.5">
                            {fmt.description}
                          </div>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Download Progress / Actions */}
                <div className="pt-2 border-t border-slate-100 space-y-3">
                  {downloadStatus === 'downloading' && (
                    <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                      <div className="flex items-center justify-between text-xs font-medium text-slate-700">
                        <span className="flex items-center gap-1.5">
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-900" />
                          正在下載與轉換短影音...
                        </span>
                        <span className="font-mono font-bold text-slate-900 tabular-nums">
                          {downloadProgress}%
                        </span>
                      </div>
                      <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden">
                        <div
                          className="bg-slate-900 h-full transition-all duration-300"
                          style={{ width: `${downloadProgress}%` }}
                        />
                      </div>
                      <div className="flex justify-between text-[11px] text-slate-500 font-mono">
                        <span>速度: {downloadSpeed || '計算中...'}</span>
                        <span>剩餘時間: {downloadEta || '--:--'}</span>
                      </div>
                    </div>
                  )}

                  {downloadStatus === 'completed' && (
                    <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs flex items-center justify-between">
                      <span className="flex items-center gap-2 font-medium">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                        下載完成！檔案已傳送至您的瀏覽器下載資料夾 ({downloadFileSize || '已完成'})
                      </span>
                      {activeTaskId && (
                        <a
                          href={`/api/download/file/${activeTaskId}`}
                          download
                          className="px-2.5 py-1 bg-emerald-600 text-white rounded font-semibold hover:bg-emerald-700 transition-colors"
                        >
                          重新下載
                        </a>
                      )}
                    </div>
                  )}

                  {downloadStatus === 'error' && (
                    <div className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-red-800 text-xs flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                      <span>{downloadError || '下載失敗，請嘗試其他畫質'}</span>
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={handleStartDownload}
                      disabled={downloadStatus === 'downloading'}
                      className="flex-1 py-3 px-6 text-sm font-semibold text-white bg-slate-900 hover:bg-slate-800 disabled:bg-slate-400 rounded-xl transition-colors shadow-sm flex items-center justify-center gap-2"
                    >
                      <Download className="w-4 h-4" />
                      <span>
                        {downloadStatus === 'downloading'
                          ? '正在下載轉換中...'
                          : `下載 ${selectedFormat.includes('audio') || selectedFormat === 'mp3' ? 'MP3 音訊' : 'MP4 影片'}`}
                      </span>
                    </button>

                    {(videoData.directUrl || (videoData as any).embedUrl) && (
                      <button
                        type="button"
                        onClick={() => setPreviewOpen(true)}
                        className="py-3 px-4 text-sm font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors flex items-center gap-1.5"
                      >
                        <Play className="w-4 h-4 text-slate-600" />
                        <span>即時預覽</span>
                      </button>
                    )}

                    <a
                      href={videoData.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="p-3 text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-xl transition-colors"
                      title="開啟原始網址"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Video Preview Modal */}
        {previewOpen && videoData && (videoData.directUrl || (videoData as any).embedUrl) && (
          <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 backdrop-blur-sm">
            <div className="bg-slate-900 rounded-2xl max-w-md w-full overflow-hidden shadow-2xl border border-slate-800 flex flex-col">
              <div className="p-4 flex items-center justify-between border-b border-slate-800 text-white">
                <span className="text-sm font-semibold truncate pr-4">{videoData.title}</span>
                <button
                  onClick={() => setPreviewOpen(false)}
                  className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="bg-black flex items-center justify-center aspect-[9/16] max-h-[600px] w-full">
                {videoData.directUrl ? (
                  <video
                    src={videoData.directUrl}
                    controls
                    autoPlay
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <iframe
                    src={(videoData as any).embedUrl}
                    title={videoData.title}
                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                    allowFullScreen
                    className="w-full h-full border-0"
                  />
                )}
              </div>
            </div>
          </div>
        )}

        {/* Download History Section */}
        <section id="history-section" className="space-y-4 pt-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-slate-500" />
              <h3 className="text-base font-bold text-slate-900">最近下載紀錄</h3>
              <span className="text-xs text-slate-500">({history.length})</span>
            </div>
            {history.length > 0 && (
              <button
                onClick={clearHistory}
                className="text-xs text-slate-500 hover:text-red-600 transition-colors flex items-center gap-1"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>清除紀錄</span>
              </button>
            )}
          </div>

          {history.length === 0 ? (
            <div className="bg-white rounded-xl border border-slate-200 p-8 text-center text-slate-500 text-xs">
              尚未有下載紀錄。貼上任何 YouTube Shorts、TikTok 或 Instagram 網址即可開始！
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {history.map((item) => (
                <div
                  key={item.id}
                  className="bg-white rounded-xl border border-slate-200 p-3 flex items-center gap-3 hover:border-slate-300 transition-all shadow-sm"
                >
                  <div className="w-12 h-16 rounded-lg bg-slate-900 overflow-hidden shrink-0">
                    {item.thumbnail ? (
                      <img
                        src={item.thumbnail}
                        alt=""
                        className="w-full h-full object-cover"
                        referrerPolicy="no-referrer"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-slate-600">
                        <FileVideo className="w-5 h-5" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-slate-900 truncate">
                      {item.title}
                    </p>
                    <div className="flex items-center gap-1.5 text-[11px] text-slate-500 mt-1">
                      {getPlatformIcon(item.platform, 'w-3 h-3')}
                      <span>{new Date(item.timestamp).toLocaleDateString()}</span>
                      <span>·</span>
                      <span className="uppercase font-semibold">{item.format}</span>
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      setUrl(item.url);
                      handleParse(item.url);
                      window.scrollTo({ top: 0, behavior: 'smooth' });
                    }}
                    className="p-2 text-slate-400 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-colors shrink-0"
                    title="重新載入"
                  >
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Detailed FAQ & Solutions */}
        <section className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 space-y-6">
          <div className="border-b border-slate-100 pb-4">
            <h3 className="text-lg font-bold text-slate-900">常見問題與各大平台下載指引</h3>
            <p className="text-xs text-slate-500 mt-1">
              深入了解如何順暢下載 YouTube Shorts、TikTok 與 Instagram Reels
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Youtube className="w-5 h-5 text-red-600" />
                <h4 className="text-sm font-bold text-slate-900">YouTube Shorts</h4>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                支援 100% 穩定高畫質下載與 320kbps MP3 提取。點擊短片右側「分享」按鈕，選擇「複製連結」後貼上即可。
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Video className="w-5 h-5 text-cyan-600" />
                <h4 className="text-sm font-bold text-slate-900">TikTok 抖音</h4>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                整合直通解析通道，自動移除原創浮水印（No Watermark），支援原聲背景音樂 MP3 獨立下載，速度極快。
              </p>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Instagram className="w-5 h-5 text-pink-600" />
                <h4 className="text-sm font-bold text-slate-900">Instagram Reels</h4>
              </div>
              <p className="text-xs text-slate-600 leading-relaxed">
                若因官方防爬蟲限制無法直接解析，可點選頂部「IG 解鎖設定」填入 sessionid，或使用畫面提供的「一鍵前往備用站」即可立即下載！
              </p>
            </div>
          </div>

          <div className="pt-4 border-t border-slate-100 flex items-center gap-2 text-xs text-slate-500">
            <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
            <span>
              隱私宣告：本工具僅供個人離線備份與學習參考使用，請尊重原創作者之智慧財產權與社群平台服務條款。
            </span>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white py-6 text-center text-xs text-slate-500">
        <p>© 2026 ReelVault. 專為 YouTube Shorts、Instagram Reels 與 TikTok 設計的短影音下載工具。</p>
      </footer>
    </div>
  );
}
