import React, { useState } from "react";
import {
  X,
  Download,
  Loader2,
  Check,
  Languages,
  MoveHorizontal,
  ZoomIn,
  Subtitles,
} from "lucide-react";
import {
  AspectRatio,
  CaptionStyleId,
  ClipItem,
  VideoProject,
} from "../types";
import {
  BACKGROUND_VIDEOS,
  CAPTION_STYLES,
  SUPPORTED_LANGUAGES,
} from "../data/presets";
import { ClipPlayer } from "./ClipPlayer";
import {
  downloadSrtSubtitles,
  formatTime,
  renderAndDownloadWebmClip,
} from "../utils/exportClip";

interface ClipEditorModalProps {
  clip: ClipItem;
  project: VideoProject;
  onSave: (updated: ClipItem) => void;
  onClose: () => void;
}

export const ClipEditorModal: React.FC<ClipEditorModalProps> = ({
  clip,
  project,
  onSave,
  onClose,
}) => {
  const [draft, setDraft] = useState<ClipItem>(() => JSON.parse(JSON.stringify(clip)));
  const [tab, setTab] = useState<"framing" | "captions" | "translate">("framing");
  const [targetLang, setTargetLang] = useState("Spanish");
  const [isTranslating, setIsTranslating] = useState(false);
  const [translateErr, setTranslateErr] = useState<string | null>(null);
  const [renderPct, setRenderPct] = useState<number | null>(null);
  const [exportErr, setExportErr] = useState<string | null>(null);

  const handleCueEdit = (idx: number, text: string) => {
    const updated = [...draft.transcript];
    updated[idx] = { ...updated[idx], text };
    setDraft({ ...draft, transcript: updated });
  };

  const handleTranslate = async () => {
    setIsTranslating(true);
    setTranslateErr(null);
    try {
      const res = await fetch("/api/clips/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: draft.title,
          hookTitle: draft.hookTitle,
          transcript: draft.transcript,
          targetLanguage: targetLang,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Translation failed");

      const rawTranscript = Array.isArray(data.transcript) ? data.transcript : [];
      setDraft((prev) => ({
        ...prev,
        title: data.title || prev.title,
        hookTitle: data.hookTitle || prev.hookTitle,
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
              id: `${prev.id}-ed-${idx}`,
              startOffsetSec: start,
              endOffsetSec: end,
              text: String(c.text || ""),
              emphasisWords: Array.isArray(c.emphasisWords)
                ? c.emphasisWords.map((w) => String(w))
                : [],
            };
          }
        ),
      }));
      setTab("captions");
    } catch (err) {
      setTranslateErr(err instanceof Error ? err.message : "Translation failed");
    } finally {
      setIsTranslating(false);
    }
  };

  const handleDownloadWebm = async () => {
    setExportErr(null);
    setRenderPct(0);
    try {
      await renderAndDownloadWebmClip(draft, project, (p) => setRenderPct(p));
    } catch (err) {
      setExportErr(err instanceof Error ? err.message : "Could not export video.");
    } finally {
      setRenderPct(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xs p-4">
      <div className="w-full max-w-5xl max-h-[92vh] rounded-xl bg-[#111115] border border-[#272731] flex flex-col overflow-hidden shadow-2xl">
        {/* Top Bar */}
        <div className="px-5 py-3.5 border-b border-[#22222A] flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-white truncate">
              Clip Editor · {draft.title}
            </h2>
            <p className="text-xs text-zinc-400 font-mono tabular-nums">
              {draft.aspectRatio} · {formatTime(draft.durationSec)} · {draft.language}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => downloadSrtSubtitles(draft)}
              className="px-3 py-1.5 rounded-lg bg-[#1A1A22] hover:bg-[#23232D] border border-[#2C2C38] text-xs font-medium text-zinc-200 inline-flex items-center gap-1.5"
            >
              <Subtitles className="w-3.5 h-3.5" />
              .SRT
            </button>
            <button
              type="button"
              onClick={handleDownloadWebm}
              disabled={renderPct !== null}
              className="px-3.5 py-1.5 rounded-lg bg-[#1A1A22] hover:bg-[#23232D] border border-[#2C2C38] text-xs font-medium text-zinc-100 inline-flex items-center gap-1.5"
            >
              {renderPct !== null ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Rendering {renderPct}%
                </>
              ) : (
                <>
                  <Download className="w-3.5 h-3.5 text-blue-400" />
                  Export Video
                </>
              )}
            </button>
            <button
              type="button"
              onClick={() => {
                onSave(draft);
                onClose();
              }}
              className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-xs font-semibold text-white inline-flex items-center gap-1.5"
            >
              <Check className="w-3.5 h-3.5" />
              Save Changes
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close editor"
              className="p-1.5 rounded-lg text-zinc-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Editor Body */}
        {exportErr && (
          <div className="px-5 py-2 bg-red-950/50 border-b border-red-900/60 text-xs text-red-300">
            {exportErr}
          </div>
        )}
        <div className="flex-1 overflow-y-auto grid grid-cols-1 lg:grid-cols-12">
          {/* Left Live Preview Stage */}
          <div className="lg:col-span-5 bg-[#0B0B0E] border-b lg:border-b-0 lg:border-r border-[#22222A] p-6 flex flex-col items-center justify-center gap-4">
            <ClipPlayer clip={draft} project={project} size="editor" />
            <p className="text-[11px] text-zinc-500 text-center">
              Live WYSIWYG stage — speaker framing, Auto Hook, and caption style updates reflect immediately.
            </p>
          </div>

          {/* Right Controls */}
          <div className="lg:col-span-7 p-6 space-y-5 overflow-y-auto">
            <div className="inline-flex p-1 rounded-lg bg-[#18181F] border border-[#262630]">
              {[
                { id: "framing", label: "Framing & Trim" },
                { id: "captions", label: "Captions & Hook" },
                { id: "translate", label: "Translate" },
              ].map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id as typeof tab)}
                  className={`px-3.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                    tab === t.id ? "bg-[#262632] text-white" : "text-zinc-400 hover:text-white"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {tab === "framing" && (
              <div className="space-y-5">
                <div className="space-y-2">
                  <label className="text-xs font-medium text-zinc-300 block">
                    Export Aspect Ratio
                  </label>
                  <div className="grid grid-cols-3 gap-2.5">
                    {(["9:16", "16:9", "1:1"] as AspectRatio[]).map((ratio) => (
                      <button
                        key={ratio}
                        type="button"
                        onClick={() => setDraft({ ...draft, aspectRatio: ratio })}
                        className={`py-2.5 rounded-lg border text-xs font-mono tabular-nums transition-colors ${
                          draft.aspectRatio === ratio
                            ? "bg-blue-600/20 border-blue-500 text-white"
                            : "bg-[#17171D] border-[#272731] text-zinc-400 hover:text-white"
                        }`}
                      >
                        {ratio}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Speaker Reframe Horizontal Pan */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-zinc-300 flex items-center gap-1.5 font-medium">
                      <MoveHorizontal className="w-3.5 h-3.5 text-blue-400" />
                      Speaker Horizontal Reframe
                    </span>
                    <span className="font-mono tabular-nums text-zinc-400">
                      {draft.focalPointX}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={draft.focalPointX}
                    onChange={(e) =>
                      setDraft({ ...draft, focalPointX: Number(e.target.value) })
                    }
                    className="w-full accent-blue-600"
                  />
                </div>

                {/* Zoom Scale */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-zinc-300 flex items-center gap-1.5 font-medium">
                      <ZoomIn className="w-3.5 h-3.5 text-blue-400" />
                      Crop Zoom
                    </span>
                    <span className="font-mono tabular-nums text-zinc-400">
                      {draft.zoomScale.toFixed(2)}x
                    </span>
                  </div>
                  <input
                    type="range"
                    min={1.0}
                    max={1.8}
                    step={0.05}
                    value={draft.zoomScale}
                    onChange={(e) =>
                      setDraft({ ...draft, zoomScale: Number(e.target.value) })
                    }
                    className="w-full accent-blue-600"
                  />
                </div>

                {/* Split Screen Toggle (9:16) */}
                {draft.aspectRatio === "9:16" && (
                  <div className="pt-3 border-t border-[#22222A] space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs font-medium text-white">Split Screen Background</p>
                        <p className="text-[11px] text-zinc-500">
                          Pair speaker footage with retention gameplay or ASMR video
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          setDraft({ ...draft, splitScreen: !draft.splitScreen })
                        }
                        className={`w-10 h-5 rounded-full p-0.5 transition-colors ${
                          draft.splitScreen ? "bg-blue-600" : "bg-[#282832]"
                        }`}
                      >
                        <span
                          className={`block w-4 h-4 rounded-full bg-white transition-transform ${
                            draft.splitScreen ? "translate-x-5" : "translate-x-0"
                          }`}
                        />
                      </button>
                    </div>

                    {draft.splitScreen && (
                      <div className="grid grid-cols-2 gap-2">
                        {BACKGROUND_VIDEOS.map((bg) => (
                          <button
                            key={bg.id}
                            type="button"
                            onClick={() => setDraft({ ...draft, splitScreenBgId: bg.id })}
                            className={`px-3 py-2 rounded-lg border text-left text-xs transition-colors ${
                              draft.splitScreenBgId === bg.id
                                ? "bg-blue-600/20 border-blue-500 text-white"
                                : "bg-[#17171D] border-[#272731] text-zinc-400"
                            }`}
                          >
                            {bg.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {/* Trim Start / End */}
                {(() => {
                  const maxProjectEnd = Math.max(
                    draft.startTimeSec + 10,
                    project.durationSec || draft.endTimeSec
                  );
                  const maxStart = Math.max(0, draft.endTimeSec - 10);
                  return (
                    <div className="pt-3 border-t border-[#22222A] grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-[11px] text-zinc-400">
                          Start Offset (sec)
                        </label>
                        <input
                          type="number"
                          min={0}
                          max={maxStart}
                          value={draft.startTimeSec}
                          onChange={(e) => {
                            const raw = Number(e.target.value);
                            const s = Number.isFinite(raw)
                              ? Math.min(maxStart, Math.max(0, raw))
                              : 0;
                            setDraft({
                              ...draft,
                              startTimeSec: s,
                              durationSec: Math.max(10, draft.endTimeSec - s),
                            });
                          }}
                          className="w-full px-3 py-2 rounded-lg bg-[#17171D] border border-[#272731] text-xs font-mono tabular-nums text-white"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[11px] text-zinc-400">
                          End Offset (sec)
                        </label>
                        <input
                          type="number"
                          min={draft.startTimeSec + 10}
                          max={maxProjectEnd}
                          value={draft.endTimeSec}
                          onChange={(e) => {
                            const raw = Number(e.target.value);
                            const end = Number.isFinite(raw)
                              ? Math.min(
                                  maxProjectEnd,
                                  Math.max(draft.startTimeSec + 10, raw)
                                )
                              : draft.startTimeSec + 10;
                            setDraft({
                              ...draft,
                              endTimeSec: end,
                              durationSec: end - draft.startTimeSec,
                            });
                          }}
                          className="w-full px-3 py-2 rounded-lg bg-[#17171D] border border-[#272731] text-xs font-mono tabular-nums text-white"
                        />
                      </div>
                    </div>
                  );
                })()}
              </div>
            )}

            {tab === "captions" && (
              <div className="space-y-5">
                <div className="flex items-center justify-between gap-4">
                  <label className="text-xs font-medium text-zinc-200">
                    Show Auto Hook Banner
                  </label>
                  <button
                    type="button"
                    onClick={() =>
                      setDraft({ ...draft, showAutoHook: !draft.showAutoHook })
                    }
                    className={`w-10 h-5 rounded-full p-0.5 transition-colors ${
                      draft.showAutoHook ? "bg-blue-600" : "bg-[#282832]"
                    }`}
                  >
                    <span
                      className={`block w-4 h-4 rounded-full bg-white transition-transform ${
                        draft.showAutoHook ? "translate-x-5" : "translate-x-0"
                      }`}
                    />
                  </button>
                </div>

                {draft.showAutoHook && (
                  <div className="space-y-1.5">
                    <label className="text-xs text-zinc-400">Hook Headline</label>
                    <input
                      type="text"
                      value={draft.hookTitle}
                      onChange={(e) => setDraft({ ...draft, hookTitle: e.target.value })}
                      className="w-full px-3 py-2 rounded-lg bg-[#17171D] border border-[#272731] text-xs text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>
                )}

                <div className="space-y-2">
                  <label className="text-xs font-medium text-zinc-300 block">
                    Caption Style
                  </label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {CAPTION_STYLES.map((st) => (
                      <button
                        key={st.id}
                        type="button"
                        onClick={() =>
                          setDraft({ ...draft, captionStyle: st.id as CaptionStyleId })
                        }
                        className={`px-2.5 py-2 rounded-lg border text-xs transition-colors ${
                          draft.captionStyle === st.id
                            ? "bg-blue-600/20 border-blue-500 text-white font-medium"
                            : "bg-[#17171D] border-[#272731] text-zinc-400 hover:text-white"
                        }`}
                      >
                        {st.name}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-medium text-zinc-300 block">
                    Edit Caption Lines
                  </label>
                  <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                    {draft.transcript.map((cue, idx) => (
                      <div key={cue.id} className="flex items-start gap-2.5">
                        <span className="text-[11px] font-mono tabular-nums text-zinc-500 pt-2 w-10 shrink-0">
                          {formatTime(cue.startOffsetSec)}
                        </span>
                        <input
                          type="text"
                          value={cue.text}
                          onChange={(e) => handleCueEdit(idx, e.target.value)}
                          className="flex-1 px-3 py-1.5 rounded-lg bg-[#17171D] border border-[#272731] focus:border-blue-500 focus:outline-none text-xs text-zinc-100"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {tab === "translate" && (
              <div className="space-y-4">
                <p className="text-xs text-zinc-300 leading-relaxed">
                  Translate your hook title and every timed subtitle cue into another language using Gemini, ready for international Shorts and Reels channels.
                </p>
                <div className="flex items-center gap-3">
                  <select
                    value={targetLang}
                    onChange={(e) => setTargetLang(e.target.value)}
                    className="bg-[#17171D] border border-[#272731] rounded-lg px-3 py-2 text-xs text-white focus:outline-none focus:border-blue-500"
                  >
                    {SUPPORTED_LANGUAGES.map((l) => (
                      <option key={l} value={l}>
                        {l}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={handleTranslate}
                    disabled={isTranslating}
                    className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-xs font-semibold text-white inline-flex items-center gap-1.5"
                  >
                    {isTranslating ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Translating...
                      </>
                    ) : (
                      <>
                        <Languages className="w-3.5 h-3.5" />
                        Translate Clip
                      </>
                    )}
                  </button>
                </div>
                {translateErr && <p className="text-xs text-red-400">{translateErr}</p>}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
