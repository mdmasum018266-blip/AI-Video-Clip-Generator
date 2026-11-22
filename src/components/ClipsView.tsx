import React, { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Download,
  Pencil,
  Send,
  LayoutList,
  LayoutGrid,
  Heart,
  Copy,
  Trash2,
  Check,
  Languages,
  Loader2,
  FileText,
  Film,
  Subtitles,
  CalendarClock,
  Youtube,
  Instagram,
  Share2,
  Hash,
  Sparkles,
} from "lucide-react";
import {
  AspectRatio,
  CaptionStyleId,
  ClipItem,
  ScheduledPost,
  VideoProject,
} from "../types";
import { CAPTION_STYLES, SUPPORTED_LANGUAGES } from "../data/presets";
import { ClipPlayer } from "./ClipPlayer";
import {
  downloadSrtSubtitles,
  downloadTranscriptTxt,
  formatTime,
  renderAndDownloadWebmClip,
} from "../utils/exportClip";
import { getClipHashtags, normalizeHashtag } from "../utils/hashtags";
import { apiUrl } from "../utils/api";

interface ClipsViewProps {
  project: VideoProject;
  onBack: () => void;
  onUpdateProject: (updated: VideoProject) => void;
  onUpdateClip: (clip: ClipItem) => void;
  onDeleteClip: (clipId: string) => void;
  onOpenEditor: (clip: ClipItem) => void;
  onOpenPostModal: (clip: ClipItem, platform?: ScheduledPost["platform"]) => void;
}

export const ClipsView: React.FC<ClipsViewProps> = ({
  project,
  onBack,
  onUpdateProject,
  onUpdateClip,
  onDeleteClip,
  onOpenEditor,
  onOpenPostModal,
}) => {
  const [viewMode, setViewMode] = useState<"list" | "grid">("list");

  const handleGlobalAspectChange = (ratio: AspectRatio) => {
    onUpdateProject({
      ...project,
      aspectRatio: ratio,
      clips: project.clips.map((c) => ({ ...c, aspectRatio: ratio })),
    });
  };

  const handleGlobalCaptionStyle = (style: CaptionStyleId) => {
    onUpdateProject({
      ...project,
      captionStyle: style,
      clips: project.clips.map((c) => ({ ...c, captionStyle: style })),
    });
  };

  return (
    <div className="max-w-[1200px] mx-auto px-6 py-6 space-y-5">
      {/* Header Bar */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-4 border-b border-[#22222A]">
        <div className="flex items-start gap-3 min-w-0">
          <button
            type="button"
            onClick={onBack}
            aria-label="Back to videos"
            className="mt-0.5 p-2 rounded-lg bg-[#15151A] hover:bg-[#1E1E26] border border-[#262630] text-zinc-300 hover:text-white transition-colors shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div className="min-w-0">
            <h1 className="text-lg sm:text-xl font-bold text-white truncate">
              {project.title}
            </h1>
            <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400 mt-1 font-mono tabular-nums">
              <span className="font-sans">{project.createdAt}</span>
              <span aria-hidden="true">·</span>
              <span className="font-sans capitalize">{project.sourceType}</span>
              <span aria-hidden="true">·</span>
              <span>{project.aspectRatio}</span>
              <span aria-hidden="true">·</span>
              <span className="font-sans">{project.clipType}</span>
              <span aria-hidden="true">·</span>
              <span>{project.clips.length} clips</span>
            </div>
          </div>
        </div>

        {/* Workspace Toolbar Controls */}
        <div className="flex flex-wrap items-center gap-2.5 shrink-0">
          <div className="inline-flex p-1 rounded-lg bg-[#15151A] border border-[#25252E]">
            {(["9:16", "16:9", "1:1"] as AspectRatio[]).map((ratio) => (
              <button
                key={ratio}
                type="button"
                onClick={() => handleGlobalAspectChange(ratio)}
                className={`px-2.5 py-1 rounded text-xs font-mono tabular-nums transition-colors ${
                  project.aspectRatio === ratio
                    ? "bg-blue-600 text-white"
                    : "text-zinc-400 hover:text-white"
                }`}
              >
                {ratio}
              </button>
            ))}
          </div>

          <select
            value={project.captionStyle}
            aria-label="Restyle all captions"
            onChange={(e) => handleGlobalCaptionStyle(e.target.value as CaptionStyleId)}
            className="bg-[#15151A] border border-[#25252E] rounded-lg px-3 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-blue-500"
          >
            {CAPTION_STYLES.map((st) => (
              <option key={st.id} value={st.id}>
                Captions: {st.name}
              </option>
            ))}
          </select>

          <div className="inline-flex p-1 rounded-lg bg-[#15151A] border border-[#25252E]">
            <button
              type="button"
              onClick={() => setViewMode("list")}
              className={`px-2.5 py-1 rounded text-xs font-medium inline-flex items-center gap-1.5 transition-colors ${
                viewMode === "list"
                  ? "bg-[#25252F] text-white"
                  : "text-zinc-400 hover:text-white"
              }`}
            >
              <LayoutList className="w-3.5 h-3.5" />
              List
            </button>
            <button
              type="button"
              onClick={() => setViewMode("grid")}
              className={`px-2.5 py-1 rounded text-xs font-medium inline-flex items-center gap-1.5 transition-colors ${
                viewMode === "grid"
                  ? "bg-[#25252F] text-white"
                  : "text-zinc-400 hover:text-white"
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              Grid
            </button>
          </div>
        </div>
      </div>

      {/* Ready Notification Strip matching reference */}
      {project.clips.length > 0 && (
        <div className="rounded-lg bg-[#121622] border border-blue-500/30 px-4 py-2.5 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-zinc-200 flex items-center gap-2">
            <CalendarClock className="w-4 h-4 text-blue-400 shrink-0" />
            <span>
              Your clips are ready — schedule them to TikTok, Instagram Reels, YouTube Shorts & more.
            </span>
          </p>
          <button
            type="button"
            onClick={() => onOpenPostModal(project.clips[0], "TikTok")}
            className="px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white transition-colors whitespace-nowrap shrink-0"
          >
            Schedule now
          </button>
        </div>
      )}

      {/* Clips Collection */}
      {project.clips.length === 0 ? (
        <div className="rounded-xl bg-[#121216] border border-[#24242D] p-12 text-center space-y-3">
          <p className="text-sm font-medium text-zinc-200">No clips remaining in this project</p>
          <p className="text-xs text-zinc-500">
            Return to the dashboard to generate fresh clips from a video or URL.
          </p>
          <button
            type="button"
            onClick={onBack}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white transition-colors"
          >
            Back to Videos
          </button>
        </div>
      ) : (
        <div
          className={
            viewMode === "grid"
              ? "grid grid-cols-1 md:grid-cols-2 gap-6"
              : "space-y-6"
          }
        >
          {project.clips.map((clip) => (
            <ClipCard
              key={clip.id}
              clip={clip}
              project={project}
              compact={viewMode === "grid"}
              onUpdateClip={onUpdateClip}
              onDelete={() => onDeleteClip(clip.id)}
              onEdit={() => onOpenEditor(clip)}
              onPost={(platform) => onOpenPostModal(clip, platform)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

interface ClipCardProps {
  clip: ClipItem;
  project: VideoProject;
  compact: boolean;
  onUpdateClip: (clip: ClipItem) => void;
  onDelete: () => void;
  onEdit: () => void;
  onPost: (platform?: ScheduledPost["platform"]) => void;
}

const ClipCard: React.FC<ClipCardProps> = ({
  clip,
  project,
  compact,
  onUpdateClip,
  onDelete,
  onEdit,
  onPost,
}) => {
  const [activeTab, setActiveTab] = useState<"transcript" | "viral" | "translate">("transcript");
  const [seekReq, setSeekReq] = useState<{ sec: number; seq: number } | null>(null);
  const [currentPlaySec, setCurrentPlaySec] = useState<number>(0);
  const [copied, setCopied] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [renderPct, setRenderPct] = useState<number | null>(null);
  const [exportErr, setExportErr] = useState<string | null>(null);
  const [targetLang, setTargetLang] = useState("Spanish");
  const [isTranslating, setIsTranslating] = useState(false);
  const [translateErr, setTranslateErr] = useState<string | null>(null);
  const [isGeneratingTags, setIsGeneratingTags] = useState(false);
  const [tagErr, setTagErr] = useState<string | null>(null);
  const [copiedTags, setCopiedTags] = useState(false);
  const exportMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!exportOpen) return;
    const handleOutside = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) {
        setExportOpen(false);
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExportOpen(false);
    };
    document.addEventListener("mousedown", handleOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [exportOpen]);

  const displayedTags = getClipHashtags(clip, project, "TikTok");

  const handleCopy = () => {
    const text = `${clip.title}\n\n${clip.transcript.map((t) => t.text).join(" ")}\n\n${displayedTags.join(
      " "
    )}`;
    navigator.clipboard?.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const handleGenerateHashtags = async () => {
    setIsGeneratingTags(true);
    setTagErr(null);
    try {
      const res = await fetch(apiUrl("/api/clips/hashtags"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: clip.title,
          projectTitle: project.title,
          clipType: project.clipType,
          language: clip.language,
          platform: "TikTok",
          transcriptText: clip.transcript.map((t) => t.text).join(" "),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not generate hashtags");
      const cleaned = (Array.isArray(data.hashtags) ? data.hashtags : [])
        .map(normalizeHashtag)
        .filter(Boolean);
      onUpdateClip({
        ...clip,
        videoCategory: data.videoCategory || clip.videoCategory,
        hashtags: cleaned.length > 0 ? cleaned : displayedTags,
      });
    } catch (err) {
      setTagErr(
        err instanceof Error ? err.message : "Could not refresh hashtags right now."
      );
    } finally {
      setIsGeneratingTags(false);
    }
  };

  const handleVideoDownload = async () => {
    setExportOpen(false);
    setExportErr(null);
    setRenderPct(0);
    try {
      await renderAndDownloadWebmClip(clip, project, (pct) => setRenderPct(pct));
    } catch (err) {
      setExportErr(err instanceof Error ? err.message : "Could not render WebM video.");
    } finally {
      setRenderPct(null);
    }
  };

  const handleTranslate = async () => {
    setIsTranslating(true);
    setTranslateErr(null);
    try {
      const res = await fetch(apiUrl("/api/clips/translate"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: clip.title,
          hookTitle: clip.hookTitle,
          transcript: clip.transcript,
          targetLanguage: targetLang,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Translation failed");

      const rawTranscript = Array.isArray(data.transcript) ? data.transcript : [];
      onUpdateClip({
        ...clip,
        title: data.title || clip.title,
        hookTitle: data.hookTitle || clip.hookTitle,
        language: targetLang,
        transcript: rawTranscript.map(
          (
            c: {
              startOffsetSec?: number;
              endOffsetSec?: number;
              text?: string;
              emphasisWords?: unknown;
            },
            idx: number
          ) => {
            const start = Math.max(0, Number(c.startOffsetSec) || 0);
            const end = Math.max(start + 1, Number(c.endOffsetSec) || start + 5);
            return {
              id: `${clip.id}-tr-${idx}`,
              startOffsetSec: start,
              endOffsetSec: end,
              text: String(c.text || ""),
              emphasisWords: Array.isArray(c.emphasisWords)
                ? c.emphasisWords.map((w) => String(w))
                : [],
            };
          }
        ),
      });
      setActiveTab("transcript");
    } catch (err) {
      setTranslateErr(err instanceof Error ? err.message : "Failed to translate clip");
    } finally {
      setIsTranslating(false);
    }
  };

  const scoreColor =
    clip.viralityScore >= 88
      ? "text-emerald-400"
      : clip.viralityScore >= 78
      ? "text-amber-400"
      : "text-zinc-300";

  return (
    <article className="rounded-xl bg-[#121216] border border-[#24242D] p-5 space-y-4">
      {/* Top Row: Rank + Title + Resolution / Virality Score */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <span className="font-mono tabular-nums text-sm font-semibold text-zinc-500">
            #{clip.rank}
          </span>
          <h2 className="text-base font-bold text-white truncate">{clip.title}</h2>
        </div>

        <div className="flex items-center gap-3 text-xs font-mono tabular-nums shrink-0">
          <span className="text-zinc-400">{clip.resolution}</span>
          <span aria-hidden="true" className="text-zinc-700">
            ·
          </span>
          <span className="text-zinc-400">{clip.language}</span>
          <span aria-hidden="true" className="text-zinc-700">
            ·
          </span>
          <span className={`font-semibold ${scoreColor}`}>
            Score {clip.viralityScore}/100
          </span>
        </div>
      </div>

      {/* Main Content Split: Player + Inspector */}
      <div
        className={`flex flex-col ${
          compact ? "items-center" : "lg:flex-row lg:items-start"
        } gap-6`}
      >
        {/* Left: Player + Action Buttons */}
        <div className="flex flex-col items-center lg:items-start gap-3 shrink-0">
          <ClipPlayer
            clip={clip}
            project={project}
            externalSeek={seekReq}
            onTimeUpdate={(sec) => setCurrentPlaySec(sec)}
          />

          <div className="w-full flex items-center gap-2 relative">
            <div ref={exportMenuRef} className="relative flex-1">
              <button
                type="button"
                onClick={() => setExportOpen((o) => !o)}
                disabled={renderPct !== null}
                className="w-full px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-xs font-semibold text-white inline-flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap"
              >
                {renderPct !== null ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    {renderPct}%
                  </>
                ) : (
                  <>
                    <Download className="w-3.5 h-3.5" />
                    Download
                  </>
                )}
              </button>

              {exportOpen && (
                <div className="absolute left-0 bottom-11 w-52 z-30 rounded-lg bg-[#18181F] border border-[#2D2D38] p-1.5 shadow-xl space-y-0.5">
                  <button
                    type="button"
                    onClick={handleVideoDownload}
                    className="w-full text-left px-3 py-2 rounded hover:bg-white/5 text-xs text-zinc-100 flex items-center gap-2"
                  >
                    <Film className="w-3.5 h-3.5 text-blue-400" />
                    Render Video (.webm)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      downloadSrtSubtitles(clip);
                      setExportOpen(false);
                    }}
                    className="w-full text-left px-3 py-2 rounded hover:bg-white/5 text-xs text-zinc-100 flex items-center gap-2"
                  >
                    <Subtitles className="w-3.5 h-3.5 text-emerald-400" />
                    Subtitles (.srt)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      downloadTranscriptTxt(clip);
                      setExportOpen(false);
                    }}
                    className="w-full text-left px-3 py-2 rounded hover:bg-white/5 text-xs text-zinc-100 flex items-center gap-2"
                  >
                    <FileText className="w-3.5 h-3.5 text-zinc-400" />
                    Transcript (.txt)
                  </button>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={onEdit}
              className="px-3 py-2 rounded-lg bg-[#1A1A22] hover:bg-[#23232D] border border-[#2C2C38] text-xs font-medium text-zinc-200 inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
            >
              <Pencil className="w-3.5 h-3.5" />
              Edit
            </button>

            <button
              type="button"
              onClick={() => onPost("TikTok")}
              className="px-3 py-2 rounded-lg bg-[#1A1A22] hover:bg-[#23232D] border border-[#2C2C38] text-xs font-medium text-zinc-200 inline-flex items-center gap-1.5 transition-colors whitespace-nowrap"
            >
              <Send className="w-3.5 h-3.5" />
              Post
            </button>
          </div>
          {exportErr && (
            <p className="text-[11px] text-red-400 max-w-[248px]">{exportErr}</p>
          )}
        </div>

        {/* Right: Segmented Transcript / Viral Analysis / Translate + Quick Publish */}
        <div className="flex-1 w-full min-w-0 flex flex-col justify-between space-y-4">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="inline-flex p-1 rounded-lg bg-[#18181F] border border-[#262630]">
                <button
                  type="button"
                  onClick={() => setActiveTab("transcript")}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                    activeTab === "transcript"
                      ? "bg-[#262632] text-white"
                      : "text-zinc-400 hover:text-white"
                  }`}
                >
                  Transcript
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("viral")}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${
                    activeTab === "viral"
                      ? "bg-[#262632] text-white"
                      : "text-zinc-400 hover:text-white"
                  }`}
                >
                  Why This Goes Viral
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab("translate")}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium inline-flex items-center gap-1.5 transition-colors whitespace-nowrap ${
                    activeTab === "translate"
                      ? "bg-[#262632] text-white"
                      : "text-zinc-400 hover:text-white"
                  }`}
                >
                  <Languages className="w-3.5 h-3.5" />
                  Translate
                </button>
              </div>

              <span className="text-[11px] font-mono tabular-nums text-zinc-500">
                {formatTime(clip.startTimeSec)} – {formatTime(clip.endTimeSec)}
              </span>
            </div>

            {activeTab === "transcript" && (
              <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                {clip.transcript.map((cue) => {
                  const isActive =
                    currentPlaySec >= cue.startOffsetSec &&
                    currentPlaySec <= cue.endOffsetSec;
                  return (
                    <button
                      key={cue.id}
                      type="button"
                      onClick={() =>
                        setSeekReq((prev) => ({
                          sec: cue.startOffsetSec,
                          seq: (prev?.seq ?? 0) + 1,
                        }))
                      }
                      className={`w-full text-left p-2.5 rounded-lg border transition-colors flex items-start gap-3 ${
                        isActive
                          ? "bg-blue-950/25 border-blue-500/40 text-white"
                          : "bg-[#16161B] border-transparent hover:border-[#282832] text-zinc-300"
                      }`}
                    >
                      <span className="text-[11px] font-mono tabular-nums text-zinc-500 pt-0.5 shrink-0">
                        {formatTime(cue.startOffsetSec)}
                      </span>
                      <span className="text-sm leading-relaxed">{cue.text}</span>
                    </button>
                  );
                })}
              </div>
            )}

            {activeTab === "viral" && (
              <div className="space-y-4 p-4 rounded-lg bg-[#16161B] border border-[#24242D]">
                <p className="text-sm text-zinc-200 leading-relaxed">{clip.whyViral}</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-3 border-t border-[#23232C]">
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-zinc-400">Hook Strength</span>
                      <span className="font-mono tabular-nums text-white font-semibold">
                        {clip.hookStrength}/100
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-[#24242D] overflow-hidden">
                      <div
                        className="h-full bg-emerald-500 rounded-full"
                        style={{ width: `${clip.hookStrength}%` }}
                      />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-zinc-400">Pacing & Retention</span>
                      <span className="font-mono tabular-nums text-white font-semibold">
                        {clip.pacingScore}/100
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-[#24242D] overflow-hidden">
                      <div
                        className="h-full bg-blue-500 rounded-full"
                        style={{ width: `${clip.pacingScore}%` }}
                      />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {activeTab === "translate" && (
              <div className="space-y-3 p-4 rounded-lg bg-[#16161B] border border-[#24242D]">
                <p className="text-xs text-zinc-300">
                  Translate the hook banner and all timed captions into another language with Gemini while keeping cue timing intact.
                </p>
                <div className="flex flex-wrap items-center gap-2.5">
                  <select
                    value={targetLang}
                    onChange={(e) => setTargetLang(e.target.value)}
                    aria-label="Target translation language"
                    className="bg-[#111115] border border-[#2B2B36] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
                  >
                    {SUPPORTED_LANGUAGES.map((lang) => (
                      <option key={lang} value={lang}>
                        {lang}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={handleTranslate}
                    disabled={isTranslating}
                    className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-xs font-semibold text-white inline-flex items-center gap-1.5 transition-colors"
                  >
                    {isTranslating ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Translating...
                      </>
                    ) : (
                      <>
                        <Languages className="w-3.5 h-3.5" />
                        Translate Captions
                      </>
                    )}
                  </button>
                </div>
                {translateErr && <p className="text-xs text-red-400">{translateErr}</p>}
              </div>
            )}

            {/* Automatic Video-Type Hashtags */}
            <div className="rounded-lg bg-[#16161B] border border-[#24242D] p-3 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-[11px] text-zinc-400">
                  <Hash className="w-3.5 h-3.5 text-blue-400" />
                  <span>
                    Auto #Tags
                    {clip.videoCategory ? ` · ${clip.videoCategory}` : ` · ${project.clipType}`}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={isGeneratingTags}
                    onClick={handleGenerateHashtags}
                    className="px-2.5 py-1 rounded bg-[#1E1E27] hover:bg-[#272733] border border-[#2C2C38] text-[11px] font-medium text-zinc-200 inline-flex items-center gap-1 disabled:opacity-50"
                  >
                    {isGeneratingTags ? (
                      <Loader2 className="w-3 h-3 animate-spin text-blue-400" />
                    ) : (
                      <Sparkles className="w-3 h-3 text-blue-400" />
                    )}
                    {isGeneratingTags ? "Generating..." : "Refresh #Tags"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard?.writeText(displayedTags.join(" "));
                      setCopiedTags(true);
                      setTimeout(() => setCopiedTags(false), 1500);
                    }}
                    className="px-2.5 py-1 rounded bg-[#1E1E27] hover:bg-[#272733] border border-[#2C2C38] text-[11px] font-medium text-zinc-200 inline-flex items-center gap-1"
                  >
                    {copiedTags ? (
                      <Check className="w-3 h-3 text-emerald-400" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                    {copiedTags ? "Copied" : "Copy"}
                  </button>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {displayedTags.map((tag) => (
                  <span
                    key={tag}
                    className="px-2 py-0.5 rounded bg-[#111116] border border-[#262631] text-[11px] font-mono text-blue-300"
                  >
                    {tag}
                  </span>
                ))}
              </div>
              {tagErr && <p className="text-[11px] text-amber-400">{tagErr}</p>}
            </div>

            {/* Quick Publish Destination Buttons matching reference */}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => onPost("YouTube Shorts")}
                className="px-3 py-1.5 rounded-lg bg-[#17171D] hover:bg-[#202029] border border-[#282832] text-xs font-medium text-zinc-200 inline-flex items-center gap-1.5 transition-colors"
              >
                <Youtube className="w-3.5 h-3.5 text-red-500" />
                YT Shorts
              </button>
              <button
                type="button"
                onClick={() => onPost("Instagram Reels")}
                className="px-3 py-1.5 rounded-lg bg-[#17171D] hover:bg-[#202029] border border-[#282832] text-xs font-medium text-zinc-200 inline-flex items-center gap-1.5 transition-colors"
              >
                <Instagram className="w-3.5 h-3.5 text-pink-400" />
                Reels
              </button>
              <button
                type="button"
                onClick={() => onPost("TikTok")}
                className="px-3 py-1.5 rounded-lg bg-[#17171D] hover:bg-[#202029] border border-[#282832] text-xs font-medium text-zinc-200 inline-flex items-center gap-1.5 transition-colors"
              >
                <Share2 className="w-3.5 h-3.5 text-cyan-400" />
                TikTok
              </button>
            </div>
          </div>

          {/* Card Footer Utilities */}
          <div className="flex items-center justify-between pt-3 border-t border-[#202028]">
            <span className="text-[11px] text-zinc-500">
              Style:{" "}
              {CAPTION_STYLES.find((s) => s.id === clip.captionStyle)?.name ??
                clip.captionStyle}
            </span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => onUpdateClip({ ...clip, isFavorite: !clip.isFavorite })}
                aria-label={clip.isFavorite ? "Remove from favorites" : "Add to favorites"}
                className={`p-2 rounded-lg transition-colors ${
                  clip.isFavorite
                    ? "text-rose-400 bg-rose-500/10"
                    : "text-zinc-500 hover:text-white hover:bg-white/5"
                }`}
              >
                <Heart className={`w-4 h-4 ${clip.isFavorite ? "fill-current" : ""}`} />
              </button>
              <button
                type="button"
                onClick={handleCopy}
                aria-label="Copy transcript"
                className="p-2 rounded-lg text-zinc-500 hover:text-white hover:bg-white/5 transition-colors"
              >
                {copied ? (
                  <Check className="w-4 h-4 text-emerald-400" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </button>
              <button
                type="button"
                onClick={onDelete}
                aria-label="Delete clip"
                className="p-2 rounded-lg text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-colors"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </article>
  );
};
