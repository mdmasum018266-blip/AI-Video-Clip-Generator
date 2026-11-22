import React, { useState } from "react";
import {
  ArrowLeft,
  Check,
  X,
  Youtube,
  Upload,
  Clock,
  Sparkles,
  Loader2,
  RectangleVertical,
  RectangleHorizontal,
  Square,
  Columns2,
} from "lucide-react";
import {
  AspectRatio,
  BrandTemplate,
  CaptionStyleId,
} from "../types";
import {
  BACKGROUND_VIDEOS,
  CAPTION_STYLES,
  CLIP_TYPE_TEMPLATES,
  SUPPORTED_LANGUAGES,
} from "../data/presets";
import { CaptionPreview } from "./CaptionPreview";
import { formatTime, parseTimeInput } from "../utils/exportClip";

export interface DraftVideoSource {
  sourceType: "youtube" | "upload" | "twitch" | "drive" | "direct";
  url?: string;
  youtubeId?: string;
  localVideoUrl?: string;
  thumbnailUrl: string;
  title: string;
  channel: string;
  durationSec: number;
  language?: string;
  topicSummary?: string;
  mediaBase64?: string;
  mediaMimeType?: string;
}

export interface ConfigureSubmitPayload {
  title: string;
  clipType: string;
  customPrompt: string;
  targetDurationSec: number;
  clipCount: number;
  captionStyle: CaptionStyleId;
  autoHook: boolean;
  language: string;
  timeframeStartSec: number;
  timeframeEndSec: number;
  aspectRatio: AspectRatio;
  splitScreen: boolean;
  splitScreenBgId: string;
  userNotes: string;
}

interface ConfigureViewProps {
  source: DraftVideoSource;
  brandTemplates: BrandTemplate[];
  initialClipCount?: number;
  onBack: () => void;
  onGenerate: (config: ConfigureSubmitPayload) => Promise<void>;
  isGenerating: boolean;
  generateError: string | null;
}

export const ConfigureView: React.FC<ConfigureViewProps> = ({
  source,
  brandTemplates,
  initialClipCount = 5,
  onBack,
  onGenerate,
  isGenerating,
  generateError,
}) => {
  const [title, setTitle] = useState(source.title);
  const [mode, setMode] = useState<"templates" | "custom">("templates");
  const [clipType, setClipType] = useState("Viral Clips");
  const [customPrompt, setCustomPrompt] = useState("");
  const [targetDurationSec, setTargetDurationSec] = useState(45);
  const [clipCount, setClipCount] = useState(initialClipCount);
  const [clipCountInput, setClipCountInput] = useState(String(initialClipCount));
  const [captionStyle, setCaptionStyle] = useState<CaptionStyleId>("classic");
  const [autoHook, setAutoHook] = useState(true);
  const [language, setLanguage] = useState(
    source.language && SUPPORTED_LANGUAGES.includes(source.language)
      ? source.language
      : "English"
  );
  const [startSec, setStartSec] = useState(0);
  const [endSec, setEndSec] = useState(source.durationSec);
  const [startText, setStartText] = useState("0:00");
  const [endText, setEndText] = useState(formatTime(source.durationSec));
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("9:16");
  const [splitScreen, setSplitScreen] = useState(false);
  const [bgCategory, setBgCategory] = useState<string>("All");
  const [splitScreenBgId, setSplitScreenBgId] = useState<string>(BACKGROUND_VIDEOS[0].id);
  const [userNotes, setUserNotes] = useState("");
  const [imgErr, setImgErr] = useState(false);

  const minSpan = Math.min(60, Math.max(10, source.durationSec));

  const handleStartBlur = () => {
    const parsed = parseTimeInput(startText);
    if (parsed !== null) {
      const clamped = Math.max(0, Math.min(parsed, Math.max(0, endSec - minSpan)));
      setStartSec(clamped);
      setStartText(formatTime(clamped));
    } else {
      setStartText(formatTime(startSec));
    }
  };

  const handleEndBlur = () => {
    const parsed = parseTimeInput(endText);
    if (parsed !== null) {
      const clamped = Math.min(
        source.durationSec,
        Math.max(parsed, Math.min(source.durationSec, startSec + minSpan))
      );
      setEndSec(clamped);
      setEndText(formatTime(clamped));
    } else {
      setEndText(formatTime(endSec));
    }
  };

  const applyTemplate = (tplId: string) => {
    const tpl = brandTemplates.find((t) => t.id === tplId);
    if (!tpl) return;
    setCaptionStyle(tpl.captionStyle);
    setAspectRatio(tpl.aspectRatio);
    setAutoHook(tpl.autoHook);
    setSplitScreen(tpl.splitScreen);
  };

  const filteredBackgrounds =
    bgCategory === "All"
      ? BACKGROUND_VIDEOS
      : BACKGROUND_VIDEOS.filter((b) => b.category === bgCategory);

  const processingSpan = Math.max(10, endSec - startSec);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isGenerating) return;
    await onGenerate({
      title: title.trim() || source.title,
      clipType: mode === "templates" ? clipType : "Custom Prompt",
      customPrompt: mode === "custom" ? customPrompt : "",
      targetDurationSec,
      clipCount,
      captionStyle,
      autoHook,
      language,
      timeframeStartSec: startSec,
      timeframeEndSec: endSec,
      aspectRatio,
      splitScreen: aspectRatio === "9:16" ? splitScreen : false,
      splitScreenBgId,
      userNotes,
    });
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="max-w-[1200px] mx-auto px-6 py-6 space-y-6"
    >
      <div className="flex items-center justify-between gap-4">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </button>

        {brandTemplates.length > 0 && (
          <div className="flex items-center gap-2">
            <label htmlFor="brand-tpl-select" className="text-xs text-zinc-400">
              Brand preset:
            </label>
            <select
              id="brand-tpl-select"
              defaultValue=""
              onChange={(e) => applyTemplate(e.target.value)}
              className="bg-[#16161C] border border-[#2A2A34] rounded-lg px-2.5 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-blue-500"
            >
              <option value="" disabled>
                Apply template...
              </option>
              {brandTemplates.map((bt) => (
                <option key={bt.id} value={bt.id}>
                  {bt.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-7 items-start">
        {/* Left Sticky Source Column */}
        <div className="lg:col-span-5 lg:sticky lg:top-6 space-y-4">
          <div className="rounded-xl bg-[#121216] border border-[#24242D] p-4 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-zinc-300 flex items-center gap-2">
                {source.sourceType === "youtube" ? (
                  <Youtube className="w-4 h-4 text-red-500" />
                ) : (
                  <Upload className="w-4 h-4 text-blue-400" />
                )}
                {source.sourceType === "youtube" ? "YouTube URL" : "Uploaded Media"}
              </span>
              <button
                type="button"
                onClick={onBack}
                className="text-zinc-500 hover:text-white transition-colors"
                title="Change video source"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {source.url && (
              <div className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-[#18181F] border border-emerald-500/50 text-xs text-zinc-200">
                <span className="truncate font-mono">{source.url}</span>
                <Check className="w-4 h-4 text-emerald-400 shrink-0" />
              </div>
            )}

            {/* Video / Thumbnail Preview */}
            <div className="relative aspect-video w-full rounded-lg overflow-hidden bg-zinc-900 border border-[#26262F]">
              {source.localVideoUrl ? (
                <video
                  src={source.localVideoUrl}
                  controls
                  className="w-full h-full object-cover"
                />
              ) : !imgErr && source.thumbnailUrl ? (
                <img
                  src={source.thumbnailUrl}
                  alt={title}
                  referrerPolicy="no-referrer"
                  onError={() => setImgErr(true)}
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="w-full h-full bg-gradient-to-br from-zinc-800 to-zinc-950 flex items-center justify-center text-xs text-zinc-400 px-4 text-center">
                  {title}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                aria-label="Project title"
                className="w-full bg-transparent border-b border-transparent focus:border-blue-500 focus:outline-none text-sm font-semibold text-white pb-1"
              />
              <div className="flex items-center gap-2 text-xs text-zinc-400 font-mono tabular-nums">
                <span className="font-sans">{source.channel}</span>
                <span aria-hidden="true">·</span>
                <span>{formatTime(source.durationSec)}</span>
              </div>
            </div>

            {/* Optional Creator Context / Transcript Seed */}
            <div className="pt-3 border-t border-[#22222A] space-y-1.5">
              <label
                htmlFor="creator-notes"
                className="text-xs font-medium text-zinc-300 block"
              >
                Transcript or Topic Notes (Optional)
              </label>
              <textarea
                id="creator-notes"
                rows={3}
                value={userNotes}
                onChange={(e) => setUserNotes(e.target.value)}
                placeholder="Paste a transcript excerpt or describe the key moments you want Gemini to prioritize..."
                className="w-full rounded-lg bg-[#17171D] border border-[#272731] focus:border-blue-500 focus:outline-none p-2.5 text-xs text-zinc-200 placeholder:text-zinc-500 resize-none"
              />
            </div>
          </div>
        </div>

        {/* Right Configuration Stack */}
        <div className="lg:col-span-7 space-y-5">
          {/* 1. Clip Type */}
          <section className="rounded-xl bg-[#121216] border border-[#24242D] p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-white">Clip Type</h2>
                <p className="text-xs text-zinc-400">
                  Choose what kind of clips to generate
                </p>
              </div>
              <div className="inline-flex p-1 rounded-lg bg-[#1A1A21] border border-[#282832]">
                <button
                  type="button"
                  onClick={() => setMode("templates")}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                    mode === "templates"
                      ? "bg-[#262630] text-white"
                      : "text-zinc-400 hover:text-white"
                  }`}
                >
                  Templates
                </button>
                <button
                  type="button"
                  onClick={() => setMode("custom")}
                  className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                    mode === "custom"
                      ? "bg-[#262630] text-white"
                      : "text-zinc-400 hover:text-white"
                  }`}
                >
                  Custom
                </button>
              </div>
            </div>

            {mode === "templates" ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {CLIP_TYPE_TEMPLATES.map((tpl) => {
                  const selected = clipType === tpl.id;
                  return (
                    <button
                      key={tpl.id}
                      type="button"
                      onClick={() => setClipType(tpl.id)}
                      className={`text-left p-3.5 rounded-lg border transition-colors ${
                        selected
                          ? "bg-[#181D29] border-blue-500 text-white"
                          : "bg-[#17171D] border-[#262630] text-zinc-300 hover:border-zinc-600"
                      }`}
                    >
                      <p className="text-xs font-semibold">{tpl.title}</p>
                      <p className="text-[11px] text-zinc-400 mt-1 leading-relaxed">
                        {tpl.subtitle}
                      </p>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="space-y-3">
                <textarea
                  rows={2}
                  value={customPrompt}
                  onChange={(e) => setCustomPrompt(e.target.value)}
                  placeholder="e.g. Find debates about AI pricing, rapid product launches, or contrarian founder advice..."
                  className="w-full rounded-lg bg-[#17171D] border border-[#272731] focus:border-blue-500 focus:outline-none p-3 text-xs text-white placeholder:text-zinc-500"
                />
                <div className="flex items-center justify-between gap-4">
                  <span className="text-xs text-zinc-400">Target clip length</span>
                  <div className="flex items-center gap-1.5">
                    {[30, 45, 60].map((sec) => (
                      <button
                        key={sec}
                        type="button"
                        onClick={() => setTargetDurationSec(sec)}
                        className={`px-2.5 py-1 rounded text-xs font-mono tabular-nums border transition-colors ${
                          targetDurationSec === sec
                            ? "bg-blue-600/20 border-blue-500 text-blue-300"
                            : "bg-[#17171D] border-[#272731] text-zinc-400 hover:text-white"
                        }`}
                      >
                        ~{sec}s
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <div className="pt-3 border-t border-[#22222A] flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-xs font-semibold text-white">Number of Clips</h3>
                <p className="text-[11px] text-zinc-400">
                  Choose how many clips AI should generate (1–15)
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {[3, 5, 8, 10, 12].map((cnt) => (
                  <button
                    key={cnt}
                    type="button"
                    onClick={() => {
                      setClipCount(cnt);
                      setClipCountInput(String(cnt));
                    }}
                    className={`px-2.5 py-1 rounded text-xs font-mono tabular-nums border transition-colors ${
                      clipCount === cnt
                        ? "bg-blue-600/20 border-blue-500 text-blue-300 font-semibold"
                        : "bg-[#17171D] border-[#272731] text-zinc-400 hover:text-white"
                    }`}
                  >
                    {cnt}
                  </button>
                ))}
                <div className="inline-flex items-center gap-1.5 pl-1">
                  <span className="text-[11px] text-zinc-500">Custom:</span>
                  <input
                    type="number"
                    min={1}
                    max={15}
                    value={clipCountInput}
                    aria-label="Custom clip count"
                    onChange={(e) => {
                      const raw = e.target.value;
                      setClipCountInput(raw);
                      if (raw.trim() === "") return;
                      const val = Math.floor(Number(raw));
                      if (!Number.isNaN(val)) {
                        setClipCount(Math.min(15, Math.max(1, val)));
                      }
                    }}
                    onBlur={() => setClipCountInput(String(clipCount))}
                    className="w-14 px-2 py-1 rounded bg-[#17171D] border border-[#272731] focus:border-blue-500 focus:outline-none text-xs font-mono tabular-nums text-white text-center"
                  />
                </div>
              </div>
            </div>
          </section>

          {/* 2. Captions */}
          <section className="rounded-xl bg-[#121216] border border-[#24242D] p-5 space-y-4">
            <div>
              <h2 className="text-sm font-semibold text-white">Captions</h2>
              <p className="text-xs text-zinc-400">
                Add animated captions to your clips and choose a style
              </p>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {CAPTION_STYLES.map((style) => {
                const selected = captionStyle === style.id;
                return (
                  <button
                    key={style.id}
                    type="button"
                    onClick={() => setCaptionStyle(style.id)}
                    className={`rounded-lg border p-2.5 flex flex-col items-center justify-between gap-2 transition-colors ${
                      selected
                        ? "bg-[#181D29] border-blue-500"
                        : "bg-[#16161C] border-[#25252F] hover:border-zinc-600"
                    }`}
                  >
                    <div className="w-full h-14 rounded bg-[#0D0D11] flex flex-col items-center justify-center px-1.5 overflow-hidden">
                      <CaptionPreview
                        styleId={style.id}
                        text={`${style.sampleTop} ${style.sampleBottom}`}
                        emphasisWords={[style.sampleBottom]}
                        compact
                      />
                    </div>
                    <span
                      className={`text-[11px] font-medium ${
                        selected ? "text-blue-300" : "text-zinc-400"
                      }`}
                    >
                      {style.name}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* 3. Auto Hook & Language */}
          <section className="rounded-xl bg-[#121216] border border-[#24242D] p-5 space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 className="text-sm font-semibold text-white">Auto Hook</h2>
                <p className="text-xs text-zinc-400">
                  AI hook title at the top of every clip to grab attention
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={autoHook}
                onClick={() => setAutoHook((h) => !h)}
                className={`w-11 h-6 rounded-full transition-colors p-0.5 shrink-0 ${
                  autoHook ? "bg-blue-600" : "bg-[#282832]"
                }`}
              >
                <span
                  className={`block w-5 h-5 rounded-full bg-white transition-transform ${
                    autoHook ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
            </div>

            <div className="pt-3 border-t border-[#22222A] flex items-center justify-between gap-4">
              <div>
                <h3 className="text-sm font-semibold text-white">Language</h3>
                <p className="text-xs text-zinc-400">
                  Transcription & caption language
                </p>
              </div>
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                aria-label="Clip language"
                className="bg-[#18181F] border border-[#2B2B36] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
              >
                {SUPPORTED_LANGUAGES.map((lang) => (
                  <option key={lang} value={lang}>
                    {lang}
                  </option>
                ))}
              </select>
            </div>
          </section>

          {/* 4. Processing Timeframe */}
          <section className="rounded-xl bg-[#121216] border border-[#24242D] p-5 space-y-4">
            <div>
              <h2 className="text-sm font-semibold text-white">Processing Timeframe</h2>
              <p className="text-xs text-zinc-400">
                Select which part of the video to process
              </p>
            </div>

            <div className="space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[11px] text-zinc-400">Start</label>
                  <div className="relative">
                    <Clock className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={startText}
                      onChange={(e) => setStartText(e.target.value)}
                      onBlur={handleStartBlur}
                      className="w-full pl-8 pr-3 py-2 rounded-lg bg-[#17171D] border border-[#272731] text-xs font-mono tabular-nums text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] text-zinc-400">End</label>
                  <div className="relative">
                    <Clock className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={endText}
                      onChange={(e) => setEndText(e.target.value)}
                      onBlur={handleEndBlur}
                      className="w-full pl-8 pr-3 py-2 rounded-lg bg-[#17171D] border border-[#272731] text-xs font-mono tabular-nums text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 items-center">
                <input
                  type="range"
                  min={0}
                  max={Math.max(0, endSec - minSpan)}
                  value={startSec}
                  aria-label="Timeframe start slider"
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    setStartSec(val);
                    setStartText(formatTime(val));
                  }}
                  className="w-full accent-blue-600"
                />
                <input
                  type="range"
                  min={Math.min(source.durationSec, startSec + minSpan)}
                  max={source.durationSec}
                  value={endSec}
                  aria-label="Timeframe end slider"
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    setEndSec(val);
                    setEndText(formatTime(val));
                  }}
                  className="w-full accent-blue-600"
                />
              </div>

              <div className="px-3 py-2 rounded-lg bg-[#17171D] border border-[#24242D] text-xs text-zinc-300 font-mono tabular-nums">
                Processing {formatTime(processingSpan)} of {formatTime(source.durationSec)}
                {startSec === 0 && endSec === source.durationSec ? " (full video)" : ""}
              </div>
            </div>
          </section>

          {/* 5. Aspect Ratio & Layout Options */}
          <section className="rounded-xl bg-[#121216] border border-[#24242D] p-5 space-y-5">
            <div className="space-y-2.5">
              <div>
                <h2 className="text-sm font-semibold text-white">Export Aspect Ratio</h2>
                <p className="text-xs text-zinc-400">
                  Automatically reframe speakers for vertical, square, or widescreen feeds
                </p>
              </div>
              <div className="grid grid-cols-3 gap-2.5">
                {[
                  { id: "9:16" as AspectRatio, label: "9:16 Vertical", sub: "TikTok · Reels · Shorts", icon: RectangleVertical },
                  { id: "16:9" as AspectRatio, label: "16:9 Landscape", sub: "YouTube · X", icon: RectangleHorizontal },
                  { id: "1:1" as AspectRatio, label: "1:1 Square", sub: "LinkedIn · Feed", icon: Square },
                ].map((opt) => {
                  const Icon = opt.icon;
                  const active = aspectRatio === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setAspectRatio(opt.id)}
                      className={`p-3 rounded-lg border text-left transition-colors ${
                        active
                          ? "bg-[#181D29] border-blue-500 text-white"
                          : "bg-[#16161C] border-[#262630] text-zinc-300 hover:border-zinc-600"
                      }`}
                    >
                      <Icon className={`w-4 h-4 mb-1.5 ${active ? "text-blue-400" : "text-zinc-500"}`} />
                      <p className="text-xs font-semibold">{opt.label}</p>
                      <p className="text-[11px] text-zinc-500">{opt.sub}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="pt-4 border-t border-[#22222A] space-y-3">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                    <Columns2 className="w-4 h-4 text-zinc-400" />
                    Split Screen Layout
                  </h3>
                  <p className="text-xs text-zinc-400">
                    Add engaging background footage below the speaker in 9:16 mode
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={splitScreen && aspectRatio === "9:16"}
                  disabled={aspectRatio !== "9:16"}
                  onClick={() => setSplitScreen((s) => !s)}
                  className={`w-11 h-6 rounded-full transition-colors p-0.5 shrink-0 disabled:opacity-40 ${
                    splitScreen && aspectRatio === "9:16" ? "bg-blue-600" : "bg-[#282832]"
                  }`}
                >
                  <span
                    className={`block w-5 h-5 rounded-full bg-white transition-transform ${
                      splitScreen && aspectRatio === "9:16" ? "translate-x-5" : "translate-x-0"
                    }`}
                  />
                </button>
              </div>

              {splitScreen && aspectRatio === "9:16" && (
                <div className="space-y-3 pt-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {["All", "GTA 5", "Minecraft", "Subway Surfer", "ASMR"].map((cat) => (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => setBgCategory(cat)}
                        className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                          bgCategory === cat
                            ? "bg-blue-600 text-white"
                            : "bg-[#1A1A22] text-zinc-400 hover:text-white"
                        }`}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    {filteredBackgrounds.map((bg) => {
                      const active = splitScreenBgId === bg.id;
                      return (
                        <button
                          key={bg.id}
                          type="button"
                          onClick={() => setSplitScreenBgId(bg.id)}
                          className={`relative aspect-[9/12] rounded-lg overflow-hidden border text-left transition-all ${
                            active ? "border-blue-500 ring-1 ring-blue-500" : "border-[#282832]"
                          }`}
                        >
                          <img
                            src={bg.thumbnailUrl}
                            alt={bg.name}
                            referrerPolicy="no-referrer"
                            className="w-full h-full object-cover"
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-transparent to-transparent" />
                          <div className="absolute bottom-1.5 inset-x-2">
                            <p className="text-[11px] font-medium text-white truncate">
                              {bg.name}
                            </p>
                            <p className="text-[10px] font-mono text-zinc-400">
                              {bg.durationLabel}
                            </p>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          </section>

          {generateError && (
            <div className="rounded-lg bg-red-950/40 border border-red-500/40 px-4 py-3 text-xs text-red-300">
              {generateError}
            </div>
          )}

          {/* Primary Generate Action */}
          <div className="flex items-center justify-end gap-3 pt-1 pb-8">
            <button
              type="button"
              onClick={onBack}
              className="px-4 py-2.5 rounded-lg bg-[#17171D] hover:bg-[#202029] border border-[#292933] text-xs font-medium text-zinc-300 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isGenerating}
              className="px-6 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-sm font-semibold text-white inline-flex items-center gap-2 transition-colors"
            >
              {isGenerating ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Scoring Moments & Transcribing...
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  Generate AI Clips
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </form>
  );
};
