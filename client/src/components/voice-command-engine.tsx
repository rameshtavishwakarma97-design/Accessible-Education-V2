import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { Mic, MicOff } from "lucide-react";
import { useAuth } from "@/lib/auth-context";

// ─── Types ────────────────────────────────────────────────
interface VoiceCommandEngineProps {
  /** Content-viewer specific callbacks — only active on /student/content/:id */
  onPlayPause?: () => void;
  onSpeedUp?: () => void;
  onSlowDown?: () => void;
  onFormatChange?: (format: string) => void;
  onOpenProfile?: () => void;
  defaultEnabled?: boolean;
}

// ─── Command Map ──────────────────────────────────────────
const COMMANDS: { keywords: string[]; action: string }[] = [
  // Playback
  { keywords: ["play", "start", "resume", "begin"],           action: "PLAY"        },
  { keywords: ["pause", "stop", "hold", "freeze"],            action: "PAUSE"       },
  { keywords: ["speed up", "faster", "increase speed"],       action: "SPEED_UP"    },
  { keywords: ["slow down", "slower", "decrease speed"],      action: "SLOW_DOWN"   },

  // Format switching — covers every way a student might phrase it
  { keywords: ["audio", "listen", "read aloud", "read to me",
               "audio format", "switch audio", "open audio"], action: "FORMAT_AUDIO"},
  { keywords: ["simplified", "simple", "easy",
               "simplified text", "open simplified",
               "easy version"],                               action: "FORMAT_SIMPLIFIED"},
  { keywords: ["transcript", "transcription",
               "open transcript", "show transcript",
               "text version", "text format",
               "switch to text"],                             action: "FORMAT_TEXT"  },
  { keywords: ["original", "default", "normal",
               "original format"],                            action: "FORMAT_ORIGINAL"},
  { keywords: ["high contrast", "contrast",
               "dark mode", "braille"],                       action: "FORMAT_HC"    },

  // Dashboard navigation (global)
  { keywords: ["go to dashboard", "dashboard", "home"],       action: "NAV_DASHBOARD"},
  { keywords: ["go to courses", "open courses", "courses"],   action: "NAV_COURSES"  },
  { keywords: ["assessments", "open assessments", "quizzes"], action: "NAV_ASSESSMENTS"},
  { keywords: ["messages", "open messages", "inbox"],         action: "NAV_MESSAGES" },
  { keywords: ["announcements"],                              action: "NAV_ANNOUNCEMENTS"},
  { keywords: ["profile", "edit profile", "accessibility settings"], action: "NAV_PROFILE"},
];

// ─── Component ────────────────────────────────────────────
export default function VoiceCommandEngine({
  onPlayPause,
  onSpeedUp,
  onSlowDown,
  onFormatChange,
  onOpenProfile,
  defaultEnabled = false,
}: VoiceCommandEngineProps) {
  const [, navigate] = useLocation();
  const [location] = useLocation();
  const { user } = useAuth();
  const role = user?.role ?? "student";
  const isContentViewer = location.startsWith("/student/content");

  const [isListening, setIsListening] = useState(false);
  const [isEnabled, setIsEnabled] = useState(defaultEnabled);
  const [lastCommand, setLastCommand] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [isSupported, setIsSupported] = useState(false);
  const recognitionRef = useRef<any>(null);

  // ── Browser support check (client-side only) ─────────────
  useEffect(() => {
    const SR =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    setIsSupported(!!SR);
  }, []);

  // ── Setup recognition ────────────────────────────────────
  useEffect(() => {
    if (!isSupported || !isEnabled) return;

    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = false;
    recognition.lang = "en-IN"; // Indian English

    recognition.onresult = (event: any) => {
      const transcript = event.results[event.results.length - 1][0].transcript
        .trim()
        .toLowerCase();
      handleCommand(transcript);
    };

    recognition.onerror = (event: any) => {
      if (event.error === "not-allowed") {
        setFeedback("🚫 Mic permission denied — check browser settings");
      } else if (event.error === "network") {
        setFeedback("🌐 Network error — voice recognition needs internet");
      } else if (event.error !== "no-speech") {
        setIsListening(false);
      }
    };

    recognition.onend = () => {
      // Auto-restart if still enabled (keeps listening continuously)
      if (isEnabled) recognition.start();
    };

    recognitionRef.current = recognition;
    recognition.start();
    setIsListening(true);

    return () => {
      recognition.stop();
      setIsListening(false);
    };
  }, [isEnabled]);

  // ── Command handler ──────────────────────────────────────
  const handleCommand = (transcript: string) => {
    for (const cmd of COMMANDS) {
      const matched = cmd.keywords.some((kw) => transcript.includes(kw));
      if (matched) {
        setLastCommand(transcript);
        executeAction(cmd.action);
        showFeedback(cmd.action);
        return;
      }
    }
  };

  const executeAction = (action: string) => {
    // ── Role-aware prefix for dashboard routes ──
    const prefix = role === "teacher" ? "/teacher" : role === "admin" ? "/admin" : "/student";

    switch (action) {
      // Playback — only on content viewer
      case "PLAY":
      case "PAUSE":
        window.dispatchEvent(new CustomEvent("voice-command-viewer", { detail: { action } }));
        if (isContentViewer) return showFeedback(action);
        return showFeedback("NOT_ON_VIEWER");
      case "SPEED_UP":
        window.dispatchEvent(new CustomEvent("voice-command-viewer", { detail: { action: "SPEED_UP" } }));
        if (isContentViewer) return showFeedback("SPEED_UP");
        return showFeedback("NOT_ON_VIEWER");
      case "SLOW_DOWN":
        window.dispatchEvent(new CustomEvent("voice-command-viewer", { detail: { action: "SLOW_DOWN" } }));
        if (isContentViewer) return showFeedback("SLOW_DOWN");
        return showFeedback("NOT_ON_VIEWER");

      // Format switching — only on content viewer
      case "FORMAT_AUDIO":
        window.dispatchEvent(new CustomEvent("voice-command-viewer", { detail: { action: "FORMAT", format: "audio" } }));
        if (isContentViewer) return showFeedback("FORMAT_AUDIO");
        return showFeedback("NOT_ON_VIEWER");
      case "FORMAT_TEXT":
        window.dispatchEvent(new CustomEvent("voice-command-viewer", { detail: { action: "FORMAT", format: "original" } }));
        if (isContentViewer) return showFeedback("FORMAT_TEXT");
        return showFeedback("NOT_ON_VIEWER");
      case "FORMAT_SIMPLIFIED":
        window.dispatchEvent(new CustomEvent("voice-command-viewer", { detail: { action: "FORMAT", format: "simplified" } }));
        if (isContentViewer) return showFeedback("FORMAT_SIMPLIFIED");
        return showFeedback("NOT_ON_VIEWER");
      case "FORMAT_ORIGINAL":
        window.dispatchEvent(new CustomEvent("voice-command-viewer", { detail: { action: "FORMAT", format: "original" } }));
        if (isContentViewer) return showFeedback("FORMAT_ORIGINAL");
        return showFeedback("NOT_ON_VIEWER");
      case "FORMAT_HC":
        window.dispatchEvent(new CustomEvent("voice-command-viewer", { detail: { action: "FORMAT", format: "high_contrast" } }));
        if (isContentViewer) return showFeedback("FORMAT_HC");
        return showFeedback("NOT_ON_VIEWER");

      // Navigation — works everywhere
      case "NAV_DASHBOARD":     return navigate(`${prefix}/dashboard`);
      case "NAV_COURSES":       return navigate(`${prefix}/${role === "student" ? "courses" : "dashboard"}`);
      case "NAV_ASSESSMENTS":   return navigate(`${prefix}/assessments`);
      case "NAV_MESSAGES":      return navigate("/messages");
      case "NAV_ANNOUNCEMENTS": return navigate("/announcements");
      case "NAV_PROFILE":       return onOpenProfile?.();
    }
  };

  // ── Visual feedback (toast-style) ────────────────────────
  const showFeedback = (action: string) => {
    const messages: Record<string, string> = {
      PLAY:              "▶ Playing",
      PAUSE:             "⏸ Paused",
      SPEED_UP:          "⚡ Speed increased",
      SLOW_DOWN:         "🐢 Speed decreased",
      FORMAT_AUDIO:      "🎧 Switched to Audio",
      FORMAT_TEXT:       "📄 Switched to Text",
      FORMAT_SIMPLIFIED: "✏️ Switched to Simplified",
      FORMAT_ORIGINAL:   "📄 Switched to Original",
      FORMAT_HC:         "🔲 High Contrast / Braille",
      NAV_DASHBOARD:     "🏠 Going to Dashboard",
      NAV_COURSES:       "📚 Going to Courses",
      NAV_ASSESSMENTS:   "📝 Going to Assessments",
      NAV_MESSAGES:      "💬 Going to Messages",
      NAV_ANNOUNCEMENTS: "📢 Going to Announcements",
      NAV_PROFILE:       "👤 Opening Profile",
      NOT_ON_VIEWER:     "ℹ️ Open a content page first",
    };
    setFeedback(messages[action] ?? "Command executed");
    setTimeout(() => setFeedback(null), 2000);
  };

  // ── Toggle handler ───────────────────────────────────────
  const toggleVoice = () => {
    if (isEnabled) {
      recognitionRef.current?.stop();
      setIsListening(false);
    }
    setIsEnabled((prev) => !prev);
  };

  if (!isSupported) return null; // silently hide if browser doesn't support

  // ─── UI ──────────────────────────────────────────────────
  return (
    <div className="relative flex items-center gap-2">

      {/* Feedback toast */}
      {feedback && (
        <div className="absolute -top-10 left-1/2 -translate-x-1/2 bg-black 
            text-white text-xs px-3 py-1 rounded-full whitespace-nowrap z-50 
            animate-fade-in">
          {feedback}
        </div>
      )}

      {/* Mic toggle button */}
      <button
        onClick={toggleVoice}
        title={isEnabled ? "Voice commands ON (click to disable)" : "Enable voice commands"}
        aria-label={isEnabled ? "Voice commands enabled" : "Voice commands disabled"}
        className={`p-2 rounded-full transition-all duration-200 ${
          isEnabled
            ? isListening
              ? "bg-red-500 text-white animate-pulse"
              : "bg-red-300 text-white"
            : "bg-gray-200 text-gray-500 hover:bg-gray-300"
        }`}
      >
        {isEnabled ? <Mic size={18} /> : <MicOff size={18} />}
      </button>

      {/* Tooltip: last recognized command */}
      {isEnabled && lastCommand && (
        <span className="text-xs text-muted-foreground hidden sm:block max-w-[140px] truncate">
          "{lastCommand}"
        </span>
      )}
    </div>
  );
}