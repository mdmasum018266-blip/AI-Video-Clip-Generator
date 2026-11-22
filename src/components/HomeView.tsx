import React, { useRef, useState } from "react";
import {
  Link2,
  Upload,
  ChevronDown,
  Sparkles,
  SlidersHorizontal,
  PlayCircle,
  Loader2,
  Video,
  Youtube,
  FolderOpen,
} from "lucide-react";
import { VideoProject } from "../types";
import { formatTime } from "../utils/exportClip";

interface HomeViewProps {
  projects: VideoProject[];
  greetingName?: string;
  onQuickGenerateFromUrl: (url: string) => Promise<void>;
  onInspectUrl: (url: string) => Promise<void>;
  onUploadFile: (file: File) => Promise<void>;
  onOpenProject: (projectId: string) => void;
  isInspecting: boolean;
  quickGeneratingLabel: string | null;
  inspectError: string | null;
}

const SAMPLE_URLS = [
  {
    label: "Zaanse Schans Windmill Documentary (28:06)",
    url: "https://youtu.be/khkddIYhx1U?si=-9UeP-NAs4zYkgZK",
  },
  {
    label: "Founder Podcast on AI Leverage (42:15)",
    url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  },
];

export const HomeView: React.FC<HomeViewProps> = ({
  projects,
  greetingName,
  onQuickGenerateFromUrl,
  onInspectUrl,
  onUploadFile,
  onOpenProject,
  isInspecting,
  quickGeneratingLabel,
  inspectError,
}) => {
  const [urlInput, setUrlInput] = useState("");
  const [showSamples, setShowSamples] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const busy = isInspecting || Boolean(quickGeneratingLabel);

  const handleQuickGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!urlInput.trim() || busy) return;
    await onQuickGenerateFromUrl(urlInput.trim());
  };

  const handleOpenConfigure = async () => {
    if (!urlInput.trim() || busy) return;
    await onInspectUrl(urlInput.trim());
  };

  const handleFileChange = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    await onUploadFile(files[0]);
  };

  const recentUserProjects = projects.filter((p) => !p.isDemo);
  const demoProjects = projects.filter((p) => p.isDemo);

  return (
    <div className="max-w-[1200px] mx-auto px-6 py-8 space-y-10">
      {/* Greeting */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">
            Hey, {greetingName || "Creator"}
          </h1>
          <p className="text-sm text-zinc-400 mt-1">
            Paste a video link to generate ranked short clips immediately, or configure custom styles first.
          </p>
        </div>
      </div>

      {/* Main Video Ingestion Card */}
      <section
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          handleFileChange(e.dataTransfer.files);
        }}
        className={`rounded-xl bg-[#121216] border transition-colors p-6 sm:p-8 max-w-3xl mx-auto ${
          isDragging ? "border-blue-500 bg-blue-950/10" : "border-[#25252E]"
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {}}
              className="px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold inline-flex items-center gap-1.5 shadow-sm"
            >
              <Link2 className="w-3.5 h-3.5" />
              Paste Video Link
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => fileInputRef.current?.click()}
              className="px-3 py-1.5 rounded-lg bg-[#181820] hover:bg-[#22222D] disabled:opacity-50 text-zinc-300 hover:text-white text-xs font-medium inline-flex items-center gap-1.5 transition-colors border border-[#2C2C36]"
            >
              {isInspecting && !quickGeneratingLabel ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />
              ) : (
                <Upload className="w-3.5 h-3.5 text-blue-400" />
              )}
              {isInspecting && !quickGeneratingLabel ? "Loading File..." : "Upload File"}
            </button>
          </div>

          <div className="relative">
            <button
              type="button"
              onClick={() => setShowSamples((s) => !s)}
              className="flex items-center gap-1.5 text-xs font-medium text-blue-400 hover:text-blue-300 transition-colors whitespace-nowrap"
            >
              Try a sample link
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
            {showSamples && (
              <div className="absolute right-0 mt-2 w-72 z-20 rounded-lg bg-[#18181F] border border-[#2D2D38] p-1.5 shadow-xl">
                {SAMPLE_URLS.map((item) => (
                  <button
                    key={item.url}
                    type="button"
                    onClick={() => {
                      setUrlInput(item.url);
                      setShowSamples(false);
                    }}
                    className="w-full text-left px-3 py-2 rounded-md hover:bg-white/5 text-xs text-zinc-200 transition-colors"
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <form onSubmit={handleQuickGenerate} className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-2.5">
            <div className="relative flex-1">
              <Link2 className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                placeholder="Paste a YouTube, Twitch, Drive or video link..."
                className="w-full pl-10 pr-4 py-3 rounded-lg bg-[#191920] border border-[#2B2B35] focus:border-blue-500 focus:outline-none text-sm text-white placeholder:text-zinc-500 transition-colors"
              />
            </div>

            <button
              type="submit"
              disabled={!urlInput.trim() || busy}
              className="px-5 py-3 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer text-sm font-semibold text-white flex items-center justify-center gap-2 transition-colors whitespace-nowrap shrink-0"
            >
              {quickGeneratingLabel ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {quickGeneratingLabel}
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  Generate Clips
                </>
              )}
            </button>

            <button
              type="button"
              onClick={handleOpenConfigure}
              disabled={!urlInput.trim() || busy}
              title="Customize caption style, timeframe, and split screen before generating"
              className="px-4 py-3 rounded-lg bg-[#1A1A22] hover:bg-[#23232E] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer border border-[#2C2C37] text-sm font-medium text-zinc-200 flex items-center justify-center gap-2 transition-colors whitespace-nowrap shrink-0"
            >
              {isInspecting && !quickGeneratingLabel ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <SlidersHorizontal className="w-4 h-4" />
              )}
              Configure
            </button>
          </div>

          {inspectError && <p className="text-xs text-red-400">{inspectError}</p>}
        </form>

        <div className="mt-5 pt-5 border-t border-[#22222A] flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3 text-xs text-zinc-400">
            <button
              type="button"
              disabled={busy}
              onClick={() => fileInputRef.current?.click()}
              className="px-3.5 py-2 rounded-lg bg-[#1A1A22] hover:bg-[#23232E] disabled:opacity-50 border border-[#2C2C37] text-zinc-200 font-medium flex items-center gap-2 transition-colors whitespace-nowrap"
            >
              {isInspecting && !quickGeneratingLabel ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />
              ) : (
                <Upload className="w-3.5 h-3.5 text-blue-400" />
              )}
              {isInspecting && !quickGeneratingLabel
                ? "Inspecting Media..."
                : "Upload Video or Audio File"}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="video/*,audio/*"
              className="hidden"
              onChange={(e) => {
                handleFileChange(e.target.files);
                e.currentTarget.value = "";
              }}
            />
            <span className="hidden sm:inline text-zinc-500">
              MP4, MOV, WebM, MP3, WAV · Drag & drop supported
            </span>
          </div>

          <div className="flex items-center gap-3 text-xs text-zinc-500">
            <span className="flex items-center gap-1">
              <Video className="w-3.5 h-3.5" />
              9:16 · 16:9 · 1:1
            </span>
          </div>
        </div>
      </section>

      {/* User's Generated Projects (if any) */}
      {recentUserProjects.length > 0 && (
        <section className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold text-white flex items-center gap-2">
              <FolderOpen className="w-4 h-4 text-blue-400" />
              Your Recent Projects
            </h2>
            <span className="text-xs text-zinc-500 font-mono tabular-nums">
              {recentUserProjects.length} projects
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {recentUserProjects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                onOpen={() => onOpenProject(project.id)}
              />
            ))}
          </div>
        </section>
      )}

      {/* Demo Videos Grid */}
      <section className="space-y-4">
        <div>
          <h2 className="text-base font-semibold text-white">Demo Videos</h2>
          <p className="text-xs text-zinc-400 mt-0.5">
            Explore real videos with AI-generated clips. Edit captions, reframe speakers, translate, and export.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {demoProjects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              onOpen={() => onOpenProject(project.id)}
            />
          ))}
        </div>
      </section>
    </div>
  );
};

const ProjectCard: React.FC<{ project: VideoProject; onOpen: () => void }> = ({
  project,
  onOpen,
}) => {
  const [imgErr, setImgErr] = useState(false);

  return (
    <button
      type="button"
      onClick={onOpen}
      className="group text-left rounded-xl bg-[#121216] border border-[#23232C] hover:border-blue-500/50 overflow-hidden transition-colors flex flex-col"
    >
      <div className="relative aspect-video w-full bg-[#191920] overflow-hidden">
        {!imgErr && project.thumbnailUrl ? (
          <img
            src={project.thumbnailUrl}
            alt={project.title}
            referrerPolicy="no-referrer"
            onError={() => setImgErr(true)}
            className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-300"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-zinc-800 to-zinc-950 flex items-center justify-center">
            <PlayCircle className="w-8 h-8 text-zinc-500" />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-transparent" />
        <span className="absolute bottom-2 right-2 text-[11px] font-mono tabular-nums text-white bg-black/75 px-1.5 py-0.5 rounded">
          {formatTime(project.durationSec)}
        </span>
      </div>

      <div className="p-3.5 space-y-1.5 flex-1 flex flex-col justify-between">
        <h3 className="text-[13px] font-semibold text-zinc-100 line-clamp-2 leading-snug group-hover:text-white">
          {project.title}
        </h3>
        <div className="flex items-center gap-1.5 text-[11px] text-zinc-500 font-mono tabular-nums">
          <span className="truncate max-w-[110px] font-sans">{project.channel}</span>
          <span aria-hidden="true">·</span>
          <span>{project.clips.length} clips</span>
          <span aria-hidden="true">·</span>
          <span>{project.createdAt}</span>
        </div>
      </div>
    </button>
  );
};
