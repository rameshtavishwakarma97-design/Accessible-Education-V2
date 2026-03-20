import { useState, useEffect } from "react";
import { useParams, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { TTSAudioPlayer } from "@/components/content/TTSAudioPlayer";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useAuth } from "@/lib/auth-context";
import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle, FileText, ArrowLeft, Loader2, Music, Download, Pause, Play, Square, Settings2, SkipBack, SkipForward, Volume2, Type, Contrast, Maximize,
} from "lucide-react";

type ContentFormat = "original" | "audio" | "captions" | "transcript" | "simplified" | "high_contrast" | "highContrast" | "braille";

const FORMAT_LABELS: Record<string, string> = {
  original: "Original", audio: "Audio", captions: "Captions", transcript: "Transcript",
  simplified: "Simplified Text", high_contrast: "High Contrast", highContrast: "High Contrast", braille: "Braille",
};

async function fetchWithAuth(url: string) {
  const token = localStorage.getItem("auth_token");
  const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) throw new Error("Failed to load data");
  return res.json();
}

async function fetchTextWithAuth(url: string): Promise<string> {
  const token = localStorage.getItem("auth_token");
  const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!res.ok) return '';
  return res.text();
}

export default function ContentViewer() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [selectedFormat, setSelectedFormat] = useState<string>("original");
  const [isFormatSwitching, setIsFormatSwitching] = useState(false);
  const [isDownloadingAll, setIsDownloadingAll] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [fontSize, setFontSize] = useState([1.0]);
  const [focusMode, setFocusMode] = useState(false);
  const [progress, setProgress] = useState(0);

  // Audio Player State (Issue 4)
  const [audioProgress, setAudioProgress] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const [currentTime, setCurrentTime] = useState(0);

  // Blob content state
  const [blobContent, setBlobContent] = useState<string>('');
  const [blobLoading, setBlobLoading] = useState(false);
  const [formatError, setFormatError] = useState<string | null>(null);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [audioScript, setAudioScript] = useState<string | null>(null);

  const { data: ci, isLoading, isError } = useQuery({
    queryKey: ["content-item", id],
    queryFn: () => fetchWithAuth(`/api/content/${id}`),
    enabled: !!user && !!id,
    refetchInterval: (query) => {
      // Poll every 4 seconds if any format is still PENDING
      const item = query.state.data as any;
      if (!item) return false;
      const pendingKeys = [
        'transcriptStatus', 'simplifiedStatus',
        'audioStatus', 'highContrastStatus', 'brailleStatus'
      ];
      const hasPending = pendingKeys.some(
        (k) => item[k] === 'PENDING' || item[k] === 'PROCESSING'
      );
      return hasPending ? 4000 : false;
    },
  });

  // TTS Helper for Spotify-style controls
  const speak = (text: string) => {
    window.speechSynthesis.cancel();
    const cleanText = text.replace(/AUDIO_SCRIPT[\s\S]*?─+\n\n/, '');
    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.rate = playbackSpeed;

    // Estimate duration: ~150 words per minute
    const words = cleanText.split(/\s+/).length;
    const estimatedSeconds = (words / 150) * 60 / playbackSpeed;
    setAudioDuration(estimatedSeconds);

    utterance.onboundary = (event) => {
      if (event.name === 'word') {
        const charIndex = event.charIndex;
        const totalChars = cleanText.length;
        const percent = (charIndex / totalChars) * 100;
        setAudioProgress(percent);
        setCurrentTime((percent / 100) * estimatedSeconds);
      }
    };

    utterance.onend = () => {
      setPlaying(false);
      setAudioProgress(100);
      setCurrentTime(estimatedSeconds);
    };

    window.speechSynthesis.speak(utterance);
    setPlaying(true);
  };

  const skipAudio = (seconds: number) => {
    if (!blobContent || !playing) return;
    // window.speechSynthesis doesn't support seeking natively.
    // We simulate by restarting from an approximate character index.
    const cleanText = blobContent.replace(/AUDIO_SCRIPT[\s\S]*?─+\n\n/, '');
    const totalChars = cleanText.length;
    const currentPercent = audioProgress / 100;
    const estimatedSeconds = audioDuration;

    let newPercent = (currentTime + seconds) / estimatedSeconds;
    newPercent = Math.max(0, Math.min(1, newPercent));

    const newCharIndex = Math.floor(newPercent * totalChars);
    const newText = cleanText.substring(newCharIndex);

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(newText);
    utterance.rate = playbackSpeed;

    utterance.onboundary = (event) => {
      if (event.name === 'word') {
        const charOffset = event.charIndex;
        const actualCharIndex = newCharIndex + charOffset;
        const percent = (actualCharIndex / totalChars) * 100;
        setAudioProgress(percent);
        setCurrentTime((percent / 100) * estimatedSeconds);
      }
    };

    utterance.onend = () => {
      setPlaying(false);
      setAudioProgress(100);
    };

    window.speechSynthesis.speak(utterance);
    setPlaying(true);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Map format keys → flat column name prefixes (handles both camelCase variants)
  const FORMAT_COLUMN_MAP: Record<string, { pathKey: string; statusKey: string }> = {
    transcript: { pathKey: 'transcriptPath', statusKey: 'transcriptStatus' },
    simplified: { pathKey: 'simplifiedPath', statusKey: 'simplifiedStatus' },
    audio: { pathKey: 'audioPath', statusKey: 'audioStatus' },
    highContrast: { pathKey: 'highContrastPath', statusKey: 'highContrastStatus' },
    high_contrast: { pathKey: 'highContrastPath', statusKey: 'highContrastStatus' },
    braille: { pathKey: 'braillePath', statusKey: 'brailleStatus' },
  };

  // Helper: check if a format is ready (COMPLETED / APPROVED / READYFORREVIEW)
  const isFormatReady = (f: string) => {
    if (f === 'original') return true;
    const col = FORMAT_COLUMN_MAP[f];
    if (col) {
      const status = (ci as any)?.[col.statusKey];
      return status === 'COMPLETED' || status === 'APPROVED' || status === 'READYFORREVIEW';
    }
    // Fallback: legacy JSONB
    const legacy = (ci?.availableFormats as any)?.[f];
    return legacy && (legacy.status === 'COMPLETED' || legacy.status === 'APPROVED' || legacy.status === 'READYFORREVIEW');
  };

  const isFormatFailed = (f: string) => {
    if (f === 'original') return false;
    const col = FORMAT_COLUMN_MAP[f];
    if (col) {
      const status = (ci as any)?.[col.statusKey];
      return status === 'FAILED';
    }
    const legacy = (ci?.availableFormats as any)?.[f];
    return legacy?.status === 'FAILED';
  };

  const downloadAllFormats = async () => {
    setIsDownloadingAll(true);
    try {
      const readyFormats = Object.keys(FORMAT_COLUMN_MAP).filter(
        (f) => isFormatReady(f)
      );

      // Always include original
      const allFormats = ['original', ...readyFormats];

      const FORMAT_EXTENSIONS: Record<string, string> = {
        original:      '',
        transcript:    '.txt',
        simplified:    '.txt',
        audio:         '.mp3',
        highContrast:  '.pdf',
        high_contrast: '.pdf',
        braille:       '.brf',
      };

      for (const format of allFormats) {
        try {
          const res = await fetch(
            `/api/content/${id}/format-url?format=${format}`,
            { headers: { Authorization: `Bearer ${localStorage.getItem('auth_token')}` } }
          );
          const data = await res.json();
          if (!data.url) continue;

          // Fetch the actual file as a blob
          const fileRes = await fetch(data.url, {
            headers: data.source === 'local'
              ? { Authorization: `Bearer ${localStorage.getItem('auth_token')}` }
              : {},
          });
          if (!fileRes.ok) continue;

          const rawBlob = await fileRes.blob();
          const mimeOverride = format === 'audio' ? 'audio/mpeg' : rawBlob.type;
          const blob = new Blob([rawBlob], { type: mimeOverride });
          const blobUrl = URL.createObjectURL(blob);

          // Trigger download
          const a = document.createElement('a');
          a.href = blobUrl;
          const ext = FORMAT_EXTENSIONS[format] ?? '';
          a.download = `${ci?.title ?? 'document'}-${format}${ext}`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(blobUrl);

          // Small delay between downloads to avoid browser blocking
          await new Promise((r) => setTimeout(r, 600));
        } catch (err) {
          console.error(`[DownloadAll] Failed for format ${format}:`, err);
        }
      }
    } finally {
      setIsDownloadingAll(false);
    }
  };

  // 1. Fetch saved progress on mount
  useEffect(() => {
    if (!id) return;
    fetch(`/api/content/${id}/progress`, {
      headers: {
        Authorization: `Bearer ${localStorage.getItem('auth_token')}`
      }
    })
      .then(r => r.json())
      .then((data) => {
        if (data.progressPercent !== undefined) {
          setProgress(data.progressPercent);
        }
      })
      .catch((err) => {
        console.error('Failed to load progress', err);
        setProgress(0);
      });
  }, [id]);

  // 2. Real-time scroll progress calculation
  useEffect(() => {
    if (!id) return;

    const mainEl = document.getElementById('main-content');
    if (!mainEl) return;

    const handleScroll = () => {
      const scrollHeight = mainEl.scrollHeight;
      const clientHeight = mainEl.clientHeight;
      const maxScroll = scrollHeight - clientHeight;

      let scrollPercent = 0;
      if (maxScroll > 0) {
        scrollPercent = Math.round((mainEl.scrollTop / maxScroll) * 100);
      } else {
        scrollPercent = 0;
      }

      const clamped = Math.min(100, Math.max(0, scrollPercent || 0));
      setProgress(clamped);
    };

    mainEl.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll(); // Initial calculation

    return () => mainEl.removeEventListener('scroll', handleScroll);
  }, [id, isLoading]); // Re-run when loading finishes to catch the element

  // 3. Backend sync every 30s
  useEffect(() => {
    if (!id) return;
    const interval = setInterval(() => {
      fetch(`/api/content/${id}/progress`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('auth_token')}`
        },
        body: JSON.stringify({ progressPercent: progress })
      }).catch(err => console.error('Failed to save progress', err));
    }, 30000);

    return () => clearInterval(interval);
  }, [id, progress]);

  // Fetch real blob content when format changes
  useEffect(() => {
    const loadFormatContent = async (format: string) => {
      setFormatError(null);
      setBlobContent('');
      setPdfUrl(null);
      setAudioScript(null);
      setBlobLoading(true);

      // ── AUDIO: bypass format-url entirely, use transcript as TTS script ──
      if (format === 'audio') {
        try {
          const token = localStorage.getItem('auth_token');
          const tRes = await fetch(
            `/api/content/${id}/format-url?format=transcript`,
            { headers: { Authorization: `Bearer ${token}` } }
          );
          const tData = await tRes.json();

          if (!tRes.ok || tData.error) {
            setFormatError('Transcript not available — cannot generate audio.');
            return;
          }

          const scriptRes = await fetch(tData.url, {
            headers: tData.source === 'local'
              ? { Authorization: `Bearer ${token}` }
              : {},
          });

          if (!scriptRes.ok) {
            setFormatError('Could not load transcript for audio generation.');
            return;
          }

          const scriptText = await scriptRes.text();
          setAudioScript(scriptText);
        } catch {
          setFormatError('Network error loading audio. Please try again.');
        } finally {
          setBlobLoading(false);
        }
        return; // ← skip the rest of loadFormatContent entirely
      }
      // ── END AUDIO SPECIAL CASE ──

      try {
        const res = await fetch(
          `/api/content/${id}/format-url?format=${format}`,
          { headers: { Authorization: `Bearer ${localStorage.getItem('auth_token')}` } }
        );
        const data = await res.json();

        if (!res.ok || data.error) {
          setFormatError(data.error || 'This format is not yet available.');
          return;
        }

        const { url, source } = data;

        const contentRes = await fetch(url, {
          headers: source === 'local' ? { Authorization: `Bearer ${localStorage.getItem('auth_token')}` } : {},
        });

        if (!contentRes.ok) {
          setFormatError(`Could not load ${format} format. Server returned ${contentRes.status}.`);
          return;
        }

        if (format === 'highContrast' || format === 'high_contrast') {
          if (source === 'local') {
            // For private local files, we must fetch as blob and create an object URL
            // because the iframe src cannot pass the Authorization Bearer header directly
            const blob = await contentRes.blob();
            setPdfUrl(URL.createObjectURL(blob));
          } else {
            setPdfUrl(url);
          }
        } else {
          const text = await contentRes.text();
          setBlobContent(text);
        }

      } catch (err: any) {
        setFormatError('Network error loading this format. Please try again.');
        console.error('[ContentViewer] Format load failed:', err);
      } finally {
        setBlobLoading(false);
      }
    };

    if (!ci || !selectedFormat || selectedFormat === 'original') {
      setBlobContent('');
      setPdfUrl(null);
      setAudioScript(null);
      return;
    }

    const col = FORMAT_COLUMN_MAP[selectedFormat];
    const status = col ? (ci as any)[col.statusKey] : (ci.availableFormats as any)?.[selectedFormat]?.status;

    if (status !== 'COMPLETED' && status !== 'APPROVED' && status !== 'READYFORREVIEW') {
      setBlobContent('');
      setPdfUrl(null);
      setAudioScript(null);
      return;
    }

    loadFormatContent(selectedFormat);
  }, [ci, selectedFormat, id]);

  // --- Voice Command Listener ---
  useEffect(() => {
    const handleVoiceCommand = (e: any) => {
      const { action, format } = e.detail;
      if (action === "PLAY") {
        if (!playing) {
          if (audioScript) speak(audioScript);
          else if (blobContent) speak(blobContent);
        }
      } else if (action === "PAUSE") {
        if (playing) {
          window.speechSynthesis.cancel();
          setPlaying(false);
        }
      } else if (action === "SPEED_UP") {
        setPlaybackSpeed(p => Math.min(2, p + 0.25));
      } else if (action === "SLOW_DOWN") {
        setPlaybackSpeed(p => Math.max(0.25, p - 0.25));
      } else if (action === "FORMAT" && format) {
        // Translate format names to match state expectations if necessary
        const targetFormat = format === 'audio' ? 'transcript' : format; 
        setSelectedFormat(targetFormat);
      }
    };
    
    window.addEventListener("voice-command-viewer", handleVoiceCommand);
    return () => window.removeEventListener("voice-command-viewer", handleVoiceCommand);
  }, [playing, audioScript, blobContent, speak]);


  if (isLoading) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 border-b bg-card px-4 py-2"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /><span className="text-sm">Loading…</span></div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center 
                      min-h-[400px] gap-3 p-8 text-center">
        <div className="text-4xl">📄</div>
        <h2 className="text-lg font-semibold">
          Could not load this content
        </h2>
        <p className="text-sm text-muted-foreground max-w-sm">
          There was a problem fetching this document. 
          Please check your connection and try again.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="px-4 py-2 text-sm bg-primary text-primary-foreground 
                     rounded-md hover:bg-primary/90 transition-colors"
        >
          Try Again
        </button>
      </div>
    );
  }

  if (!ci) return <div className="p-8 text-center text-muted-foreground">Content not found</div>;

  // Derive available format keys from the flat columns + legacy JSONB fallback
  const knownFormats = ['transcript', 'simplified', 'audio', 'highContrast', 'braille'];
  const legacyKeys = Object.keys((ci.availableFormats as Record<string, any>) || {});
  const allFormatKeys = ['original', ...knownFormats, ...legacyKeys];
  const formatKeys = allFormatKeys.filter((f, i) => allFormatKeys.indexOf(f) === i);

  // TTS speed from user preferences
  const ttsSpeed = (user as any)?.preferences?.ttsSpeed ?? 1.0;

  return (
    <div className="flex flex-col h-full">
      <div
        className="flex items-center justify-between gap-2 border-b bg-card px-4 py-2 sticky top-0 z-10"
        aria-hidden={focusMode || undefined}
        style={focusMode ? { display: 'none' } : undefined}
      >
        <div className="flex items-center gap-2">
          <Link href={ci.courseOfferingId ? `/student/courses/${ci.courseOfferingId}` : "/student/courses"}>
            <Button variant="ghost" size="sm" className="gap-1" data-testid="button-back"><ArrowLeft className="h-3.5 w-3.5" /> Back</Button>
          </Link>
          <span className="text-xs text-muted-foreground hidden sm:inline">{ci.title}</span>
        </div>
        <div className="flex items-center gap-2">
          <Select value={selectedFormat} onValueChange={(v) => {
            setIsFormatSwitching(true);
            setSelectedFormat(v);
            setTimeout(() => setIsFormatSwitching(false), 800);
          }}>
            <SelectTrigger className="w-[140px] text-xs" data-testid="select-format" aria-label="Content format"><SelectValue /></SelectTrigger>
            <SelectContent>
              {formatKeys.map((f) => (
                <SelectItem key={f} value={f} disabled={!isFormatReady(f)}>
                  {FORMAT_LABELS[f] || f}
                  {isFormatFailed(f) && ' (unavailable)'}
                  {!isFormatReady(f) && !isFormatFailed(f) && ' (processing...)'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <main id="main-content" className="flex-1 overflow-auto">
        <div className="relative w-full h-full">
          {isFormatSwitching && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/60 backdrop-blur-sm rounded-lg">
              <div className="flex flex-col items-center gap-2">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
                <p className="text-sm text-muted-foreground">Switching view...</p>
              </div>
            </div>
          )}
        <div className="mx-auto max-w-[1440px] p-4 lg:p-6">
          <div role="status" aria-live="polite" className="sr-only">{FORMAT_LABELS[selectedFormat] || selectedFormat} format loaded.</div>

          {/* Error state */}
          {formatError && (
            <div role="alert" style={{
              padding: '24px',
              background: '#FDECEA',
              border: '1px solid #C0392B',
              borderRadius: '8px',
              color: '#C0392B',
              textAlign: 'center',
              margin: '24px'
            }}>
              <p style={{ fontWeight: 600, marginBottom: '8px' }}>Format unavailable</p>
              <p style={{ fontSize: '14px' }}>{formatError}</p>
            </div>
          )}

          <div className={`grid gap-6 ${focusMode ? 'grid-cols-1' : 'grid-cols-1 lg:grid-cols-3'}`}>
            <div className={`space-y-4 ${focusMode ? '' : 'lg:col-span-2'}`}>

              {/* ─── AUDIO FORMAT (TTS) ────────────────────── */}
              {selectedFormat === "audio" && (
                <Card className="border-none shadow-none bg-transparent">
                  <CardContent className="p-0 flex flex-col justify-center items-center min-h-[40vh]">
                    {!audioScript ? (
                      <div className="flex flex-col items-center text-muted-foreground p-8">
                        <Loader2 className="h-8 w-8 animate-spin mb-4" />
                        <p>Loading audio format...</p>
                      </div>
                    ) : (
                      <div className="w-full max-w-3xl mx-auto flex flex-col items-center">
                        <div className="mb-12 text-center">
                          <Music className="h-24 w-24 text-muted-foreground/30 mx-auto mb-6" />
                          <h3 className="text-xl font-medium">{ci.title}</h3>
                          <p className="text-sm text-muted-foreground mt-2">Audio Version</p>
                        </div>

                        <div className="w-full relative mt-auto">
                          <TTSAudioPlayer script={audioScript} />
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* ─── BRAILLE FORMAT ────────────────────────── */}
              {selectedFormat === "braille" && (
                <Card>
                  <CardContent className="px-10 py-8">
                    {blobLoading ? (
                      <div className="space-y-2 max-w-[68ch] mx-auto">
                        <Skeleton className="h-4 w-full" />
                        <Skeleton className="h-4 w-5/6" />
                        <Skeleton className="h-4 w-4/6" />
                      </div>
                    ) : blobContent ? (
                      <div className="max-w-[68ch] mx-auto space-y-6">

                        {/* Download card — primary action for braille */}
                        <div className="flex items-center justify-between
                                        rounded-lg border bg-muted/40 px-5 py-4">
                          <div>
                            <p className="font-medium text-sm">Braille File Ready</p>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              Download and send to a braille embosser or 
                              refreshable braille display device.
                            </p>
                          </div>
                          <button
                            onClick={() => {
                              const blob = new Blob([blobContent], 
                                { type: 'text/plain' });
                              const url = URL.createObjectURL(blob);
                              const a = document.createElement('a');
                              a.href = url;
                              a.download = `${ci?.title || 'document'}-braille.brf`;
                              a.click();
                              URL.revokeObjectURL(url);
                            }}
                            className="ml-4 shrink-0 inline-flex items-center 
                                       gap-2 rounded-md bg-primary px-4 py-2 
                                       text-sm font-medium text-primary-foreground
                                       hover:bg-primary/90 transition"
                            aria-label="Download braille file"
                          >
                            <svg className="h-4 w-4" fill="none" 
                                 viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M4 16v2a2 2 0 002 2h12a2 2 0 
                                       002-2v-2M7 10l5 5 5-5M12 15V3" />
                            </svg>
                            Download .brf
                          </button>
                        </div>

                        {/* Stats bar */}
                        <div className="flex gap-6 text-xs text-muted-foreground">
                          <span>
                            {blobContent.length.toLocaleString()} characters
                          </span>
                          <span>
                            {blobContent.split('\n').length.toLocaleString()} lines
                          </span>
                          <span>Standard 40-cell format</span>
                        </div>

                        {/* Braille preview — monospace, 40 chars wide */}
                        <div
                          role="region"
                          aria-label="Braille content preview"
                          aria-live="polite"
                          className="rounded-lg border bg-background p-5 
                                     overflow-x-auto"
                          style={{
                            fontFamily: 'monospace',
                            fontSize: '1.1rem',
                            lineHeight: 2.2,
                            whiteSpace: 'pre',
                            maxHeight: '55vh',
                            overflowY: 'auto',
                            wordBreak: 'break-all',
                            maxWidth: '40ch',
                          }}
                        >
                          {blobContent}
                        </div>

                        <p className="text-xs text-muted-foreground">
                          Preview uses Unicode braille patterns. 
                          The downloaded .brf file uses standard 
                          ASCII braille encoding for embossers.
                        </p>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center
                                      h-64 gap-3 text-muted-foreground 
                                      max-w-[68ch] mx-auto">
                        <svg className="h-10 w-10 opacity-30" fill="none"
                             viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round"
                                strokeWidth={1.5}
                                d="M12 6v6l4 2m6-2a10 10 0 
                                   11-20 0 10 10 0 0120 0z" />
                        </svg>
                        <p className="text-sm text-center">
                          Braille conversion is pending 
                          teacher review and approval.
                        </p>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* ─── HIGH CONTRAST PDF FORMAT ─────────────── */}
              {(selectedFormat === "high_contrast" || selectedFormat === "highContrast") && (
                <Card>
                  <CardContent className="p-0">
                    {(() => {
                      const hcStatus = (ci as any)?.highContrastStatus;
                      const hcPath   = (ci as any)?.highContrastPath;

                      // Not generated yet
                      if (!hcPath || (hcStatus !== 'COMPLETED' && hcStatus !== 'APPROVED')) {
                        return (
                          <div className="flex flex-col items-center justify-center 
                                          h-64 gap-3 text-muted-foreground">
                            <svg className="h-10 w-10 opacity-30" fill="none"
                                 viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round"
                                    strokeWidth={1.5}
                                    d="M12 6v6l4 2m6-2a10 10 0 11-20 0 
                                       10 10 0 0120 0z" />
                            </svg>
                            <p className="text-sm">
                              High contrast PDF is being generated.
                            </p>
                          </div>
                        );
                      }

                      // Loading — pdfUrl not yet set
                      if (blobLoading || !pdfUrl) {
                        return (
                          <div className="flex flex-col items-center justify-center 
                                          h-64 gap-3 text-muted-foreground">
                            <svg className="h-8 w-8 animate-spin opacity-50"
                                 fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10"
                                      stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor"
                                    d="M4 12a8 8 0 018-8v8H4z" />
                            </svg>
                            <p className="text-sm">Loading high contrast PDF...</p>
                          </div>
                        );
                      }

                      // Error state
                      if (formatError) {
                        return (
                          <div className="flex flex-col items-center justify-center 
                                          h-64 gap-3 text-destructive">
                            <p className="text-sm font-medium">
                              Could not load high contrast PDF.
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {formatError}
                            </p>
                          </div>
                        );
                      }

                      // Loaded — render iframe
                      return (
                        <iframe
                          src={pdfUrl}
                          title="High contrast PDF viewer"
                          style={{ width: '100%', height: '80vh', border: 'none' }}
                          aria-label="High contrast version of the document"
                        />
                      );
                    })()}
                  </CardContent>
                </Card>
              )}

              {/* ─── SIMPLIFIED FORMAT ─────────────────────── */}
              {selectedFormat === "simplified" && (
                <Card>
                  <CardContent className="px-10 py-8" style={{ fontSize: `${fontSize[0]}rem` }}>
                    <div className="prose max-w-none text-lg leading-[1.8]">
                      {blobLoading ? (
                        <div className="space-y-4">
                          <Skeleton className="h-6 w-48" />
                          <Skeleton className="h-4 w-full" />
                          <Skeleton className="h-4 w-full" />
                          <Skeleton className="h-4 w-3/4" />
                          <Skeleton className="h-6 w-48 mt-8" />
                          <Skeleton className="h-4 w-full" />
                          <Skeleton className="h-4 w-5/6" />
                        </div>
                      ) : (
                        blobContent ? (
                          <div
                            className="simplified-content max-w-[68ch] mx-auto"
                            style={{
                              letterSpacing: '0.02em',
                              wordSpacing:   '0.1em',
                            }}
                          >
                            {blobContent
                              .split(/\n\n---\n\n|\n---\n/)
                              .map((section, i) => {
                                // Convert markdown-ish syntax → HTML
                                const html = section
                                  // h1 headings
                                  .replace(/^# (.+)$/gm,
                                    '<h1 class="text-2xl font-bold mt-8 mb-3 ' +
                                    'text-foreground border-b pb-2">$1</h1>')
                                  // h2 headings
                                  .replace(/^## (.+)$/gm,
                                    '<h2 class="text-xl font-semibold mt-6 mb-2 ' +
                                    'text-foreground">$1</h2>')
                                  // h3 headings
                                  .replace(/^### (.+)$/gm,
                                    '<h3 class="text-lg font-semibold mt-4 mb-2 ' +
                                    'text-foreground">$1</h3>')
                                  // bold
                                  .replace(/\*\*(.*?)\*\*/g,
                                    '<strong class="font-semibold">$1</strong>')
                                  // italic
                                  .replace(/\*(.*?)\*/g, '<em>$1</em>')
                                  // numbered lists — must come before bullet lists
                                  .replace(/^\d+\. (.+)$/gm,
                                    '<li class="ml-6 mb-1 list-decimal">$1</li>')
                                  // bullet lists
                                  .replace(/^[-•] (.+)$/gm,
                                    '<li class="ml-6 mb-1 list-disc">$1</li>')
                                  // wrap consecutive <li> in <ul>/<ol>
                                  .replace(/(<li[^>]*>.*<\/li>\n?)+/g,
                                    (match) => `<ul class="my-3 space-y-1">${match}</ul>`)
                                  // blank lines → paragraph breaks
                                  .replace(/\n\n/g, '</p><p class="mb-4">')
                                  // single newlines → line breaks
                                  .replace(/\n/g, '<br/>');

                                return (
                                  <div
                                    key={i}
                                    className="simplified-section mb-8 
                                               pb-8 border-b border-border/30 
                                               last:border-0"
                                    dangerouslySetInnerHTML={{
                                      __html: `<p class="mb-4">${html}</p>`
                                    }}
                                  />
                                );
                              })}
                          </div>
                        ) : (
                          <p className="text-muted-foreground">Simplified version not yet available. The teacher will review and approve it shortly.</p>
                        )
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* ─── TRANSCRIPT FORMAT ─────────────────────── */}
              {selectedFormat === "transcript" && (
                <Card>
                  <CardContent className="px-10 py-8" style={{ fontSize: `${fontSize[0]}rem` }}>
                    {blobLoading ? (
                      <div className="space-y-3">
                        <Skeleton className="h-4 w-full" />
                        <Skeleton className="h-4 w-full" />
                        <Skeleton className="h-4 w-5/6" />
                        <Skeleton className="h-4 w-full" />
                        <Skeleton className="h-4 w-4/6" />
                      </div>
                    ) : (
                      blobContent ? (
                        <div
                          className="transcript-content max-w-[68ch] mx-auto"
                          style={{ letterSpacing: '0.01em', wordSpacing: '0.08em' }}
                        >
                          {blobContent
                            .split(/\n\n---\n\n|\n---\n/)
                            .map((section, i) => {
                              const html = section
                                // h1
                                .replace(/^# (.+)$/gm,
                                  '<h1 class="text-2xl font-bold mt-8 mb-3 ' +
                                  'border-b pb-2 text-foreground">$1</h1>')
                                // h2
                                .replace(/^## (.+)$/gm,
                                  '<h2 class="text-lg font-semibold mt-6 mb-2 ' +
                                  'text-foreground">$1</h2>')
                                // h3
                                .replace(/^### (.+)$/gm,
                                  '<h3 class="text-base font-semibold mt-4 mb-1 ' +
                                  'text-foreground">$1</h3>')
                                // timestamps — e.g. [00:00] or (00:00)
                                .replace(/[\[\(](\d{1,2}:\d{2}(?::\d{2})?)\][\)\]]/g,
                                  '<span class="inline-block text-xs font-mono ' +
                                  'bg-muted text-muted-foreground px-1.5 py-0.5 ' +
                                  'rounded mr-2 align-middle">$1</span>')
                                .replace(/[\[\(](\d{1,2}:\d{2}(?::\d{2})?)\)/g,
                                  '<span class="inline-block text-xs font-mono ' +
                                  'bg-muted text-muted-foreground px-1.5 py-0.5 ' +
                                  'rounded mr-2 align-middle">$1</span>')
                                // speaker labels — e.g. "Speaker 1:" or "PROF:"
                                .replace(/^([A-Z][A-Z\s]+\d*):(?=\s)/gm,
                                  '<span class="font-semibold text-primary ' +
                                  'text-sm uppercase tracking-wide">$1:</span>')
                                // bold
                                .replace(/\*\*(.*?)\*\*/g,
                                  '<strong class="font-semibold">$1</strong>')
                                // bullet lists
                                .replace(/^[-•] (.+)$/gm,
                                  '<li class="ml-6 mb-1 list-disc">$1</li>')
                                // numbered lists
                                .replace(/^\d+\. (.+)$/gm,
                                  '<li class="ml-6 mb-1 list-decimal">$1</li>')
                                // wrap <li> runs
                                .replace(/(<li[^>]*>.*<\/li>\n?)+/g,
                                  (m) => `<ul class="my-3 space-y-1">${m}</ul>`)
                                // paragraph breaks
                                .replace(/\n\n/g, '</p><p class="mb-4 leading-relaxed">')
                                // single newlines
                                .replace(/\n/g, '<br/>');

                              return (
                                <div
                                  key={i}
                                  className="transcript-section mb-8"
                                  dangerouslySetInnerHTML={{
                                    __html: `<p class="mb-4 leading-relaxed">${html}</p>`
                                  }}
                                />
                              );
                            })}
                        </div>
                      ) : (
                        <p className="text-muted-foreground text-sm">
                          Transcript not yet available. 
                          Please check back after conversion completes.
                        </p>
                      )
                    )}
                  </CardContent>
                </Card>
              )}

              {/* ─── ORIGINAL / CAPTIONS / DEFAULT ────────── */}
              {selectedFormat !== "braille" && selectedFormat !== "audio" && selectedFormat !== "simplified" && selectedFormat !== "transcript" && selectedFormat !== "high_contrast" && selectedFormat !== "highContrast" && (
                <Card>
                  <CardContent className="p-6" style={{ fontSize: `${fontSize[0]}rem` }}>
                    <div className={`prose max-w-none ${selectedFormat === "captions" ? "" : ""}`}>
                      <h2 className="font-serif">{ci.title}</h2>
                      {ci.description && <p className="text-muted-foreground">{ci.description}</p>}
                      {ci.originalFilePath && (
                        <p className="text-sm">
                          <a href={`/api/content/${ci.id}/format/original`} className="text-primary underline">
                            Download original file ({ci.originalFilename || 'file'})
                          </a>
                          {ci.fileSize && <span className="text-muted-foreground ml-2">({ci.fileSize})</span>}
                        </p>
                      )}
                      {/* Download All button — only show if at least 1
                          non-original format is ready */}
                      {Object.keys(FORMAT_COLUMN_MAP).some((f) => isFormatReady(f)) && (
                        <button
                          onClick={downloadAllFormats}
                          disabled={isDownloadingAll}
                          className="inline-flex items-center gap-2 mt-2 px-3 py-1.5 text-sm font-medium rounded-md border border-input bg-background hover:bg-accent hover:text-accent-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {isDownloadingAll ? (
                            <>
                              <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                              Downloading...
                            </>
                          ) : (
                            <>
                              <Download className="h-3.5 w-3.5" />
                              Download All Formats
                            </>
                          )}
                        </button>
                      )}
                      {selectedFormat === "captions" && ci.type === "video" && (
                        <div className="mt-4 bg-black/80 text-white text-sm p-3 rounded text-center">
                          [Captions will appear here during video playback]
                        </div>
                      )}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Video player for video content */}
              {ci.type === "video" && selectedFormat === "original" && (
                <Card>
                  <CardContent className="p-0">
                    <div className="aspect-video bg-[#1A2535] rounded-t-md flex items-center justify-center relative">
                      <div className="text-center text-white/60 space-y-2">
                        <Play className="h-12 w-12 mx-auto" />
                        <p className="text-sm">Video Player</p>
                        {ci.duration && <p className="text-xs">{ci.duration}</p>}
                      </div>
                    </div>
                    <div className="p-3 space-y-2">
                      <Progress value={35} className="h-1" />
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1">
                          <Button variant="ghost" size="icon" aria-label="Skip back 15 seconds" data-testid="button-skip-back"><SkipBack className="h-4 w-4" /></Button>
                          <Button variant="ghost" size="icon" onClick={() => setPlaying(!playing)} aria-label={playing ? "Pause" : "Play"} data-testid="button-play-pause">
                            {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                          </Button>
                          <Button variant="ghost" size="icon" aria-label="Skip forward 15 seconds" data-testid="button-skip-forward"><SkipForward className="h-4 w-4" /></Button>
                        </div>
                        <div className="flex items-center gap-2">
                          <Volume2 className="h-3.5 w-3.5 text-muted-foreground" />
                          <span className="text-xs text-muted-foreground">1.0x</span>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>

            {/* ─── SIDEBAR ──────────────────────────────── */}
            <div
              className="space-y-4"
              aria-hidden={focusMode || undefined}
              style={focusMode ? { display: 'none' } : undefined}
            >
              <Card>
                <CardContent className="p-4 space-y-3">
                  <h3 className="text-sm font-semibold">Content Info</h3>
                  <div className="space-y-2 text-xs">
                    <div className="flex justify-between"><span className="text-muted-foreground">Type</span><span className="capitalize">{ci.type}</span></div>
                    {ci.duration && <div className="flex justify-between"><span className="text-muted-foreground">Duration</span><span>{ci.duration}</span></div>}
                    {ci.fileSize && <div className="flex justify-between"><span className="text-muted-foreground">Size</span><span>{ci.fileSize}</span></div>}
                    <div className="flex justify-between"><span className="text-muted-foreground">Views</span><span>{ci.viewCount || 0}</span></div>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">Available Formats</p>
                    <TooltipProvider>
                      <div className="flex flex-wrap gap-1">
                        {formatKeys.map((f) => {
                          const ready = isFormatReady(f);
                          return (
                            <Tooltip key={f}>
                              <TooltipTrigger asChild>
                                <Badge
                                  variant={f === selectedFormat ? "default" : "outline"}
                                  className={`no-default-active-elevate text-[10px] ${ready ? 'cursor-pointer' : 'cursor-not-allowed'}`}
                                  style={!ready ? { opacity: 0.4 } : undefined}
                                  onClick={() => ready && setSelectedFormat(f)}
                                  aria-disabled={!ready}
                                  data-testid={`button-format-${f}`}
                                >
                                  {FORMAT_LABELS[f] || f}
                                </Badge>
                              </TooltipTrigger>
                              {!ready && (
                                <TooltipContent>
                                  <p>Not yet available</p>
                                </TooltipContent>
                              )}
                            </Tooltip>
                          );
                        })}
                      </div>
                    </TooltipProvider>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
        </div>
      </main>

      <div className="flex items-center justify-between gap-2 border-t bg-card px-4 py-2 sticky bottom-0">
        <div className="flex items-center gap-3">
          {/* Format switch buttons in footer */}
          <div className="flex items-center gap-1 border-r pr-3 mr-1 hidden md:flex" role="group" aria-label="Format buttons">
            {formatKeys.map((f) => {
              const ready = isFormatReady(f);
              return (
                <Button
                  key={f}
                  variant={f === selectedFormat ? "default" : "ghost"}
                  size="sm"
                  className="text-[11px] px-2 h-7"
                  style={!ready ? { opacity: 0.4 } : undefined}
                  onClick={() => ready && setSelectedFormat(f)}
                  disabled={!ready}
                  aria-pressed={f === selectedFormat}
                  aria-label={`Switch to ${FORMAT_LABELS[f] || f} format${!ready ? ' (not yet available)' : ''}`}
                  data-testid={`button-footer-format-${f}`}
                >
                  {FORMAT_LABELS[f] || f}
                </Button>
              );
            })}
          </div>
          <Button variant="ghost" size="sm" className="gap-1 text-xs" onClick={() => setPlaying(!playing)} aria-label={playing ? "Stop reading" : "Read aloud"} aria-pressed={playing} data-testid="button-tts">
            <Volume2 className="h-3.5 w-3.5" /> TTS
          </Button>
          <div className="flex items-center gap-2 hidden sm:flex">
            <Type className="h-3.5 w-3.5 text-muted-foreground" />
            <Slider className="w-20" min={0.5} max={3.0} step={0.1} value={fontSize} onValueChange={setFontSize} aria-valuetext={`Font size: ${Math.round(fontSize[0] * 100)}%`} aria-label="Font size" data-testid="slider-viewer-font-size" />
            <span className="text-xs text-muted-foreground w-12">{Math.round(fontSize[0] * 100)}%</span>
          </div>
          <Button variant="ghost" size="sm" className="gap-1 text-xs" onClick={() => { setSelectedFormat(selectedFormat === "highContrast" || selectedFormat === "high_contrast" ? "original" : "highContrast"); }} aria-label="Toggle high contrast" aria-pressed={selectedFormat === "high_contrast" || selectedFormat === "highContrast"} data-testid="button-contrast">
            <Contrast className="h-3.5 w-3.5" /> Contrast
          </Button>
          <Button variant="ghost" size="sm" className="gap-1 text-xs" onClick={() => setFocusMode(!focusMode)} aria-label={focusMode ? "Exit focus mode" : "Enter focus mode"} aria-pressed={focusMode} data-testid="button-focus-mode">
            <Maximize className="h-3.5 w-3.5" /> Focus
          </Button>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex flex-col items-end gap-0.5 min-w-[80px]">
            <span className="text-[10px] text-muted-foreground leading-none uppercase">Reading Progress</span>
            <span className="text-xs font-semibold tabular-nums">{progress}%</span>
          </div>
          <div className="w-[120px] bg-muted h-1.5 rounded-full overflow-hidden border">
            <div
              className="bg-primary h-full transition-all duration-300 ease-out"
              style={{ width: `${Math.min(100, progress)}%` }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
