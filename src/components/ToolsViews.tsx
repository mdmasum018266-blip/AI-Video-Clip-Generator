import React, { useEffect, useRef, useState } from "react";
import {
  Search,
  Heart,
  Pencil,
  Send,
  Plus,
  Trash2,
  Check,
  Copy,
  Bot,
  Loader2,
  ExternalLink,
  CalendarClock,
  Terminal,
  AlertCircle,
  UploadCloud,
  KeyRound,
  X,
  RefreshCw,
  Calendar,
  Users,
  List,
} from "lucide-react";
import {
  AspectRatio,
  BrandTemplate,
  CaptionStyleId,
  ClipItem,
  ChatMessage,
  ScheduledPost,
  SocialAccountStatus,
  SocialPlatformKey,
  VideoProject,
} from "../types";
import { CAPTION_STYLES } from "../data/presets";
import { formatTime } from "../utils/exportClip";
import { apiUrl } from "../utils/api";
import { CaptionPreview } from "./CaptionPreview";

/* -------------------------------------------------------------------------- */
/* 1. ALL CLIPS & FAVORITES LIBRARY VIEW                                      */
/* -------------------------------------------------------------------------- */
interface LibraryClipsViewProps {
  mode: "all" | "favorites";
  projects: VideoProject[];
  onOpenProject: (projectId: string) => void;
  onUpdateClip: (clip: ClipItem) => void;
  onOpenEditor: (clip: ClipItem, project: VideoProject) => void;
  onOpenPost: (clip: ClipItem, project: VideoProject) => void;
}

export const LibraryClipsView: React.FC<LibraryClipsViewProps> = ({
  mode,
  projects,
  onOpenProject,
  onUpdateClip,
  onOpenEditor,
  onOpenPost,
}) => {
  const [query, setQuery] = useState("");
  const [ratioFilter, setRatioFilter] = useState<"All" | AspectRatio>("All");

  const allEntries = projects.flatMap((project) =>
    project.clips.map((clip) => ({ clip, project }))
  );

  const filtered = allEntries
    .filter(({ clip }) => (mode === "favorites" ? clip.isFavorite : true))
    .filter(({ clip }) => (ratioFilter === "All" ? true : clip.aspectRatio === ratioFilter))
    .filter(({ clip, project }) => {
      if (!query.trim()) return true;
      const q = query.toLowerCase();
      return (
        clip.title.toLowerCase().includes(q) ||
        project.title.toLowerCase().includes(q) ||
        clip.transcript.some((t) => t.text.toLowerCase().includes(q))
      );
    })
    .sort((a, b) => b.clip.viralityScore - a.clip.viralityScore);

  return (
    <div className="max-w-[1200px] mx-auto px-6 py-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white">
            {mode === "favorites" ? "Favorite Clips" : "All Clips"}
          </h1>
          <p className="text-xs text-zinc-400 mt-1">
            {mode === "favorites"
              ? "Your starred high-performing moments ready for editing and scheduling."
              : "Every generated clip across your workspace ranked by virality score."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-zinc-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search titles or transcripts..."
              className="pl-8 pr-3 py-1.5 rounded-lg bg-[#141419] border border-[#262630] focus:border-blue-500 focus:outline-none text-xs text-white placeholder:text-zinc-500 w-56"
            />
          </div>

          <div className="inline-flex p-1 rounded-lg bg-[#141419] border border-[#262630]">
            {(["All", "9:16", "16:9", "1:1"] as const).map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => setRatioFilter(r)}
                className={`px-2.5 py-1 rounded text-xs font-mono tabular-nums transition-colors ${
                  ratioFilter === r ? "bg-blue-600 text-white" : "text-zinc-400 hover:text-white"
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl bg-[#121216] border border-[#24242D] p-12 text-center space-y-2">
          <p className="text-sm font-medium text-zinc-200">
            {mode === "favorites" ? "No favorite clips yet" : "No matching clips found"}
          </p>
          <p className="text-xs text-zinc-500">
            {mode === "favorites"
              ? "Click the heart icon on any clip card to save it here."
              : "Try clearing your search filter or generating clips from a new video."}
          </p>
        </div>
      ) : (
        <div className="rounded-xl bg-[#121216] border border-[#24242D] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#22222A] text-[11px] font-medium text-zinc-500">
                  <th className="py-3 px-4">Clip</th>
                  <th className="py-3 px-4">Source Video</th>
                  <th className="py-3 px-4">Format</th>
                  <th className="py-3 px-4 text-right">Duration</th>
                  <th className="py-3 px-4 text-right">Score</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1E1E25] text-xs">
                {filtered.map(({ clip, project }) => (
                  <tr key={clip.id} className="hover:bg-[#17171D] transition-colors">
                    <td className="py-3 px-4">
                      <p className="font-semibold text-zinc-100">{clip.title}</p>
                      <p className="text-[11px] text-zinc-500 truncate max-w-xs mt-0.5">
                        {clip.transcript[0]?.text}
                      </p>
                    </td>
                    <td className="py-3 px-4">
                      <button
                        type="button"
                        onClick={() => onOpenProject(project.id)}
                        className="text-zinc-300 hover:text-blue-400 inline-flex items-center gap-1 max-w-[200px] truncate transition-colors"
                      >
                        <span className="truncate">{project.title}</span>
                        <ExternalLink className="w-3 h-3 shrink-0" />
                      </button>
                    </td>
                    <td className="py-3 px-4 font-mono tabular-nums text-zinc-400">
                      {clip.aspectRatio} · {clip.language}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums text-zinc-300">
                      {formatTime(clip.durationSec)}
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums font-semibold text-emerald-400">
                      {clip.viralityScore}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="inline-flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => onUpdateClip({ ...clip, isFavorite: !clip.isFavorite })}
                          aria-label="Toggle favorite"
                          className={`p-1.5 rounded hover:bg-white/5 ${
                            clip.isFavorite ? "text-rose-400" : "text-zinc-500 hover:text-white"
                          }`}
                        >
                          <Heart className={`w-3.5 h-3.5 ${clip.isFavorite ? "fill-current" : ""}`} />
                        </button>
                        <button
                          type="button"
                          onClick={() => onOpenEditor(clip, project)}
                          aria-label="Edit clip"
                          className="p-1.5 rounded text-zinc-400 hover:text-white hover:bg-white/5"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => onOpenPost(clip, project)}
                          aria-label="Schedule post"
                          className="p-1.5 rounded text-zinc-400 hover:text-white hover:bg-white/5"
                        >
                          <Send className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* 2. BRAND TEMPLATES VIEW                                                    */
/* -------------------------------------------------------------------------- */
interface BrandTemplatesViewProps {
  templates: BrandTemplate[];
  onAddTemplate: (tpl: BrandTemplate) => void;
  onDeleteTemplate: (id: string) => void;
}

export const BrandTemplatesView: React.FC<BrandTemplatesViewProps> = ({
  templates,
  onAddTemplate,
  onDeleteTemplate,
}) => {
  const [name, setName] = useState("");
  const [captionStyle, setCaptionStyle] = useState<CaptionStyleId>("classic");
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("9:16");
  const [watermarkHandle, setWatermarkHandle] = useState("@scalereach");
  const [autoHook, setAutoHook] = useState(true);
  const [splitScreen, setSplitScreen] = useState(false);

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onAddTemplate({
      id: `bt-${Date.now()}`,
      name: name.trim(),
      captionStyle,
      aspectRatio,
      autoHook,
      accentHex: "#3B82F6",
      watermarkHandle: watermarkHandle.trim() || "@creator",
      splitScreen,
    });
    setName("");
  };

  return (
    <div className="max-w-[1200px] mx-auto px-6 py-8 space-y-8">
      <div>
        <h1 className="text-xl font-bold text-white">Brand Templates</h1>
        <p className="text-xs text-zinc-400 mt-1">
          Save reusable caption styles, aspect ratios, and hook presets for instant 1-click setup in Configure.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <form
          onSubmit={handleCreate}
          className="lg:col-span-5 rounded-xl bg-[#121216] border border-[#24242D] p-5 space-y-4"
        >
          <h2 className="text-sm font-semibold text-white">Create Template</h2>
          <div className="space-y-1.5">
            <label className="text-xs text-zinc-400">Template Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Daily Shorts Bold"
              className="w-full px-3 py-2 rounded-lg bg-[#17171D] border border-[#272731] text-xs text-white focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs text-zinc-400">Caption Style</label>
              <select
                value={captionStyle}
                onChange={(e) => setCaptionStyle(e.target.value as CaptionStyleId)}
                className="w-full px-2.5 py-2 rounded-lg bg-[#17171D] border border-[#272731] text-xs text-white"
              >
                {CAPTION_STYLES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs text-zinc-400">Aspect Ratio</label>
              <select
                value={aspectRatio}
                onChange={(e) => setAspectRatio(e.target.value as AspectRatio)}
                className="w-full px-2.5 py-2 rounded-lg bg-[#17171D] border border-[#272731] text-xs text-white"
              >
                <option value="9:16">9:16 Vertical</option>
                <option value="16:9">16:9 Widescreen</option>
                <option value="1:1">1:1 Square</option>
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs text-zinc-400">Watermark / Channel Handle</label>
            <input
              type="text"
              value={watermarkHandle}
              onChange={(e) => setWatermarkHandle(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-[#17171D] border border-[#272731] text-xs font-mono text-white"
            />
          </div>

          <div className="flex items-center justify-between text-xs text-zinc-300">
            <span>Enable Auto Hook banner</span>
            <input
              type="checkbox"
              checked={autoHook}
              onChange={(e) => setAutoHook(e.target.checked)}
              className="accent-blue-600 w-4 h-4"
            />
          </div>

          <div className="flex items-center justify-between text-xs text-zinc-300">
            <span>Split Screen default (9:16)</span>
            <input
              type="checkbox"
              checked={splitScreen}
              onChange={(e) => setSplitScreen(e.target.checked)}
              className="accent-blue-600 w-4 h-4"
            />
          </div>

          <button
            type="submit"
            disabled={!name.trim()}
            className="w-full py-2.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-xs font-semibold text-white inline-flex items-center justify-center gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            Save Brand Template
          </button>
        </form>

        <div className="lg:col-span-7 grid grid-cols-1 sm:grid-cols-2 gap-4">
          {templates.map((tpl) => (
            <div
              key={tpl.id}
              className="rounded-xl bg-[#121216] border border-[#24242D] p-4 space-y-3 flex flex-col justify-between"
            >
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold text-white truncate">{tpl.name}</h3>
                  <button
                    type="button"
                    onClick={() => onDeleteTemplate(tpl.id)}
                    aria-label="Delete template"
                    className="p-1 text-zinc-500 hover:text-red-400"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="h-20 rounded-lg bg-[#0B0B0E] border border-[#202028] flex items-center justify-center px-3">
                  <CaptionPreview
                    styleId={tpl.captionStyle}
                    text="BUILD THINGS FASTER"
                    emphasisWords={["FASTER"]}
                    compact
                  />
                </div>
              </div>

              <div className="text-[11px] text-zinc-400 font-mono tabular-nums pt-2 border-t border-[#202028] flex items-center justify-between">
                <span>
                  {tpl.aspectRatio} · {tpl.autoHook ? "Auto Hook" : "No Hook"}
                </span>
                <span>{tpl.watermarkHandle}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* 3. SOCIAL SCHEDULER VIEW                                                   */
/* -------------------------------------------------------------------------- */
interface SocialSchedulerViewProps {
  accounts: SocialAccountStatus[];
  posts: ScheduledPost[];
  connectingPlatform: SocialPlatformKey | null;
  publishingPostId: string | null;
  publishStatusText: string | null;
  publishError: string | null;
  oauthError: string | null;
  setupGuideAccount: SocialAccountStatus | null;
  autoUploadEnabled: boolean;
  autoQueueTopClip: boolean;
  isAdmin: boolean;
  isSignedIn: boolean;
  initialTab?: "calendar" | "accounts" | "posts";
  onSignInGoogle: () => void;
  onConnectPlatform: (platform: SocialPlatformKey) => void;
  onDisconnectPlatform: (platform: SocialPlatformKey) => void;
  onToggleAutoUpload: () => void;
  onToggleAutoQueueTopClip: () => void;
  onRunDueUploads: () => void;
  onPublishNow: (postId: string) => void;
  onDeletePost: (postId: string) => void;
  onCloseSetupGuide: () => void;
  onRefreshAccounts: () => void;
}

const PlatformBrandIcon: React.FC<{ platform: SocialPlatformKey }> = ({ platform }) => {
  if (platform === "tiktok") {
    return (
      <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
        <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.5 2.89 2.89 0 0 1-2.89-2.89 2.89 2.89 0 0 1 2.89-2.89c.28 0 .54.04.79.1v-3.5a6.37 6.37 0 0 0-.79-.05A6.34 6.34 0 0 0 3.15 15a6.34 6.34 0 0 0 6.34 6.34 6.34 6.34 0 0 0 6.34-6.34V8.8a8.28 8.28 0 0 0 4.76 1.5V6.86a4.84 4.84 0 0 1-1-.17Z" />
      </svg>
    );
  }
  if (platform === "instagram") {
    return (
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <defs>
          <linearGradient id="igGrad" x1="2" y1="22" x2="22" y2="2" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#F58529" />
            <stop offset="50%" stopColor="#DD2A7B" />
            <stop offset="100%" stopColor="#8134AF" />
          </linearGradient>
        </defs>
        <rect x="2.5" y="2.5" width="19" height="19" rx="5.5" stroke="url(#igGrad)" strokeWidth="2.2" />
        <circle cx="12" cy="12" r="4.2" stroke="url(#igGrad)" strokeWidth="2.2" />
        <circle cx="17.2" cy="6.8" r="1.2" fill="url(#igGrad)" />
      </svg>
    );
  }
  if (platform === "facebook") {
    return (
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="#1877F2" aria-hidden="true">
        <path d="M12 2.04c-5.5 0-10 4.49-10 10.02 0 5 3.66 9.15 8.44 9.9v-7H7.9v-2.9h2.54V9.85c0-2.51 1.49-3.89 3.78-3.89 1.09 0 2.23.19 2.23.19v2.47h-1.26c-1.24 0-1.63.77-1.63 1.56v1.88h2.78l-.45 2.9h-2.33v7a10 10 0 0 0 8.44-9.9c0-5.53-4.5-10.02-10-10.02Z" />
      </svg>
    );
  }
  if (platform === "youtube") {
    return (
      <svg className="w-4 h-4" viewBox="0 0 24 24" fill="#FF0000" aria-hidden="true">
        <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814ZM9.545 15.568V8.432L15.818 12l-6.273 3.568Z" />
      </svg>
    );
  }
  return (
    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="#0A66C2" aria-hidden="true">
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286ZM5.337 7.433a2.062 2.062 0 0 1-2.063-2.065 2.064 2.064 0 1 1 2.063 2.065Zm1.782 13.019H3.555V9h3.564v11.452ZM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003Z" />
    </svg>
  );
};

export const SocialSchedulerView: React.FC<SocialSchedulerViewProps> = ({
  accounts,
  posts,
  connectingPlatform,
  publishingPostId,
  publishStatusText,
  publishError,
  oauthError,
  setupGuideAccount,
  autoUploadEnabled,
  autoQueueTopClip,
  isAdmin,
  isSignedIn,
  initialTab = "accounts",
  onSignInGoogle,
  onConnectPlatform,
  onDisconnectPlatform,
  onToggleAutoUpload,
  onToggleAutoQueueTopClip,
  onRunDueUploads,
  onPublishNow,
  onDeletePost,
  onCloseSetupGuide,
  onRefreshAccounts,
}) => {
  const [activeTab, setActiveTab] = useState<"calendar" | "accounts" | "posts">(initialTab);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [showSecretsBox, setShowSecretsBox] = useState<boolean>(false);
  const [isRefreshing, setIsRefreshing] = useState(false);

  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  const copyText = (key: string, value: string) => {
    navigator.clipboard?.writeText(value);
    setCopiedField(key);
    setTimeout(() => setCopiedField(null), 1600);
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await Promise.resolve(onRefreshAccounts());
    } finally {
      setTimeout(() => setIsRefreshing(false), 300);
    }
  };

  const connectedCount = accounts.filter((a) => a.connected).length;
  const configuredCount = accounts.filter((a) => a.configured).length;
  const scheduledCount = posts.filter((p) => p.status === "Scheduled").length;

  const nowDate = new Date();
  const year = nowDate.getFullYear();
  const month = nowDate.getMonth();
  const monthLabel = nowDate.toLocaleDateString("en-US", { month: "long", year: "numeric" });
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstDayOffset = new Date(year, month, 1).getDay();

  const orderedPlatforms: SocialPlatformKey[] = [
    "tiktok",
    "instagram",
    "facebook",
    "youtube",
    "linkedin",
  ];
  const orderedAccounts = orderedPlatforms
    .map((p) => accounts.find((a) => a.platform === p))
    .filter((a): a is SocialAccountStatus => Boolean(a));

  return (
    <div className="max-w-[1200px] mx-auto px-6 py-7 space-y-6">
      {/* Header + Sub-tabs matching clean creator scheduler layout */}
      <div className="space-y-4 border-b border-[#202028]">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-bold text-white">Social Scheduler</h1>
            <p className="text-xs text-zinc-400 mt-1">
              Schedule and manage posts across your social accounts.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <span className="font-mono text-xs tabular-nums text-zinc-400">
              {connectedCount} of {accounts.length} connected
            </span>
            {isAdmin && (
              <button
                type="button"
                onClick={() => {
                  setActiveTab("accounts");
                  setShowSecretsBox((v) => !v);
                }}
                className="px-3 py-1.5 rounded-lg bg-[#16161C] hover:bg-[#1E1E27] border border-[#282834] text-xs font-medium text-zinc-200 inline-flex items-center gap-1.5"
              >
                <KeyRound className="w-3.5 h-3.5 text-blue-400" />
                {showSecretsBox ? "Hide Admin OAuth Config" : "Admin OAuth Config"}
              </button>
            )}
          </div>
        </div>

        <nav className="flex items-center gap-6" aria-label="Social Scheduler tabs">
          {(
            [
              { id: "calendar", label: "Calendar", Icon: Calendar },
              { id: "accounts", label: "Accounts", Icon: Users },
              { id: "posts", label: `Posts (${posts.length})`, Icon: List },
            ] as const
          ).map(({ id, label, Icon }) => {
            const isActive = activeTab === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => setActiveTab(id)}
                className={`pb-3 text-xs font-medium inline-flex items-center gap-2 border-b-2 transition-colors ${
                  isActive
                    ? "border-blue-500 text-white"
                    : "border-transparent text-zinc-400 hover:text-zinc-200"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {label}
              </button>
            );
          })}
        </nav>
      </div>

      {!isSignedIn && (
        <div className="rounded-xl bg-[#13151E] border border-blue-900/50 px-4 py-3 flex flex-wrap items-center justify-between gap-3 text-xs">
          <p className="text-zinc-300">
            Sign in with Google to save your clips, brand presets, and publishing queue across devices.
          </p>
          <button
            type="button"
            onClick={onSignInGoogle}
            className="px-3.5 py-1.5 rounded-lg bg-white hover:bg-zinc-100 text-zinc-900 font-semibold shrink-0"
          >
            Sign in with Google
          </button>
        </div>
      )}

      {/* OAuth or Publish Feedback Banners */}
      {oauthError && (
        <div className="rounded-xl bg-red-950/30 border border-red-900/60 px-4 py-3 flex items-start gap-2.5 text-xs text-red-200">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <span>{oauthError}</span>
        </div>
      )}

      {publishError && (
        <div className="rounded-xl bg-red-950/30 border border-red-900/60 px-4 py-3 flex items-start gap-2.5 text-xs text-red-200">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <span>{publishError}</span>
        </div>
      )}

      {publishStatusText && (
        <div className="rounded-xl bg-blue-950/30 border border-blue-900/60 px-4 py-3 flex items-center gap-2.5 text-xs text-blue-200">
          <Loader2 className="w-4 h-4 text-blue-400 animate-spin shrink-0" />
          <span>{publishStatusText}</span>
        </div>
      )}

      {/* TAB 1: ACCOUNTS (Clean 2-Column Platform Cards with + Connect) */}
      {activeTab === "accounts" && (
        <div className="max-w-3xl mx-auto pt-2 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-white">Connected Accounts</h2>
              <p className="text-xs text-zinc-400 mt-0.5">
                Manage your social media connections.
              </p>
            </div>
            <button
              type="button"
              onClick={handleRefresh}
              className="px-3 py-1.5 rounded-lg bg-[#14141A] hover:bg-[#1C1C25] border border-[#262632] text-xs font-medium text-zinc-300 inline-flex items-center gap-1.5"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>

          <div className="space-y-3">
            <p className="text-xs font-medium text-zinc-400">Connect a platform</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
              {orderedAccounts.map((account) => {
                const isConnecting = connectingPlatform === account.platform;
                const label =
                  account.platform === "instagram"
                    ? "Instagram"
                    : account.displayName;
                return (
                  <div
                    key={account.platform}
                    className={`rounded-xl border px-4 py-3.5 flex items-center justify-between gap-3 transition-colors ${
                      account.connected
                        ? "bg-[#12161D] border-emerald-500/35"
                        : "bg-[#111115] border-[#24242E] hover:border-[#353546]"
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-9 h-9 rounded-lg bg-[#181820] border border-[#272734] flex items-center justify-center shrink-0">
                        <PlatformBrandIcon platform={account.platform} />
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-white truncate">
                            {label}
                          </span>
                          {account.connected ? (
                            <span className="px-2 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-[10px] font-medium text-emerald-300">
                              Connected
                            </span>
                          ) : account.configured ? (
                            <span className="px-2 py-0.5 rounded-full bg-blue-500/10 border border-blue-500/25 text-[10px] font-medium text-blue-300">
                              Ready
                            </span>
                          ) : null}
                        </div>
                        {account.connected && account.accountHandle ? (
                          <p className="text-[11px] text-zinc-400 truncate mt-0.5">
                            {account.accountHandle}
                          </p>
                        ) : (
                          <p className="text-[11px] text-zinc-500 truncate mt-0.5">
                            {account.configured
                              ? account.platform === "youtube"
                                ? "Connect via Google OAuth"
                                : `Connect your ${label} account`
                              : isAdmin
                              ? "Click + to configure OAuth keys"
                              : "Ready once admin configures keys"}
                          </p>
                        )}
                      </div>
                    </div>

                    {account.connected ? (
                      <button
                        type="button"
                        disabled={isConnecting}
                        onClick={() => onDisconnectPlatform(account.platform)}
                        className="px-2.5 py-1.5 rounded-lg text-[11px] font-medium bg-[#181820] hover:bg-[#22222C] border border-[#2C2C38] text-zinc-300 hover:text-white disabled:opacity-50 shrink-0"
                      >
                        Disconnect
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={isConnecting}
                        onClick={() => onConnectPlatform(account.platform)}
                        aria-label={`Connect ${label}`}
                        title={`Connect ${label}`}
                        className="w-8 h-8 rounded-lg bg-[#17171F] hover:bg-blue-600 border border-[#2A2A38] hover:border-blue-500 text-zinc-300 hover:text-white flex items-center justify-center transition-colors disabled:opacity-50 shrink-0"
                      >
                        {isConnecting ? (
                          <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                          <Plus className="w-4 h-4" />
                        )}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Inline OAuth Credentials Setup Guide (Admin sees technical guide; public sees clean notice) */}
          {setupGuideAccount && (
            <div className="rounded-xl bg-[#121218] border border-blue-800/60 p-4 space-y-3 text-xs">
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-start gap-2.5">
                  <KeyRound className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
                  {isAdmin ? (
                    <div className="space-y-1">
                      <p className="font-semibold text-white">
                        Direct {setupGuideAccount.displayName} OAuth requires app secrets
                      </p>
                      <p className="text-zinc-300 leading-relaxed">
                        Real {setupGuideAccount.displayName} login &amp; auto-upload require{" "}
                        <code className="font-mono text-white">
                          {setupGuideAccount.requiredEnvVars[0]}
                        </code>{" "}
                        and{" "}
                        <code className="font-mono text-white">
                          {setupGuideAccount.requiredEnvVars[1]}
                        </code>{" "}
                        to be saved on the server in{" "}
                        <span className="font-medium text-white">Settings &gt; Secrets</span> (secrets are never entered in browser UI). Once saved, clicking + opens {setupGuideAccount.displayName} login directly.
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <p className="font-semibold text-white">
                        {setupGuideAccount.displayName} direct upload is not enabled yet
                      </p>
                      <p className="text-zinc-300 leading-relaxed">
                        The workspace owner has not activated direct {setupGuideAccount.displayName} publishing on this public instance yet. You can still generate, edit, and download any clip to upload manually.
                      </p>
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={onCloseSetupGuide}
                  aria-label="Close setup notice"
                  className="p-1 text-zinc-500 hover:text-white shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {isAdmin && (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <a
                    href={setupGuideAccount.developerConsoleUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="px-3 py-1.5 rounded-lg bg-[#1A1A24] hover:bg-[#242432] border border-[#2C2C3A] text-zinc-200 font-medium inline-flex items-center gap-1.5"
                  >
                    Open {setupGuideAccount.displayName} Console
                    <ExternalLink className="w-3 h-3" />
                  </a>
                  <button
                    type="button"
                    onClick={() =>
                      copyText(
                        `guide-cb-${setupGuideAccount.platform}`,
                        setupGuideAccount.callbackUrl ||
                          apiUrl(`/api/social/callback/${setupGuideAccount.platform}`)
                      )
                    }
                    className="px-3 py-1.5 rounded-lg bg-[#1A1A24] hover:bg-[#242432] border border-[#2C2C3A] text-zinc-200 font-medium inline-flex items-center gap-1.5"
                  >
                    {copiedField === `guide-cb-${setupGuideAccount.platform}` ? (
                      <Check className="w-3 h-3 text-emerald-400" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                    {copiedField === `guide-cb-${setupGuideAccount.platform}`
                      ? "Copied Redirect URI"
                      : "Copy Redirect URI"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      onRefreshAccounts();
                      onConnectPlatform(setupGuideAccount.platform);
                    }}
                    className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold inline-flex items-center gap-1.5"
                  >
                    <RefreshCw className="w-3 h-3" />
                    Retry Direct Connect
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Dedicated OAuth Secrets & Redirect URIs Box (Admin Only) */}
          {isAdmin && showSecretsBox && (
            <div className="rounded-xl bg-[#121216] border border-[#24242D] overflow-hidden">
              <div className="px-5 py-4 border-b border-[#22222A] flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-start gap-2.5">
                  <KeyRound className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
                  <div>
                    <h3 className="text-sm font-semibold text-white">
                      OAuth Secrets &amp; Redirect URIs (Admin)
                    </h3>
                    <p className="text-xs text-zinc-400 mt-0.5">
                      Add these secret pairs in AI Studio{" "}
                      <span className="text-zinc-200 font-medium">Settings &gt; Secrets</span>{" "}
                      ({configuredCount}/{accounts.length} apps configured).
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowSecretsBox(false)}
                  aria-label="Hide OAuth secrets box"
                  className="p-1.5 text-zinc-500 hover:text-white"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="divide-y divide-[#22222A]">
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-[#22222A] text-[11px] text-zinc-500 bg-[#0F0F13]">
                        <th className="py-2.5 px-4 font-medium">Secret Name</th>
                        <th className="py-2.5 px-4 font-medium">Status</th>
                        <th className="py-2.5 px-4 text-right font-medium">Copy</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1E1E25] text-xs">
                      {accounts
                        .flatMap((acct) => {
                          const [keyName, secretName] = acct.requiredEnvVars;
                          const keyReady = acct.envStatus?.keyConfigured ?? acct.configured;
                          const secretReady = acct.envStatus?.secretConfigured ?? acct.configured;
                          return [
                            { name: keyName, ready: keyReady },
                            { name: secretName, ready: secretReady },
                          ];
                        })
                        .map((row) => (
                          <tr key={row.name} className="hover:bg-[#16161C]">
                            <td className="py-2 px-4 font-mono text-[11px] text-zinc-100">
                              {row.name}
                            </td>
                            <td className="py-2 px-4 text-[11px] font-medium">
                              <span className={row.ready ? "text-emerald-400" : "text-amber-400"}>
                                {row.ready ? "Ready" : "Missing"}
                              </span>
                            </td>
                            <td className="py-2 px-4 text-right">
                              <button
                                type="button"
                                onClick={() => copyText(row.name, row.name)}
                                className="px-2 py-1 rounded bg-[#1A1A22] hover:bg-[#23232E] border border-[#2A2A35] text-[11px] text-zinc-200 inline-flex items-center gap-1"
                              >
                                {copiedField === row.name ? (
                                  <Check className="w-3 h-3 text-emerald-400" />
                                ) : (
                                  <Copy className="w-3 h-3" />
                                )}
                                {copiedField === row.name ? "Copied" : "Copy"}
                              </button>
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>

                <div className="p-4 space-y-2.5 bg-[#0E0E12]">
                  <p className="text-[11px] font-medium text-zinc-400">
                    OAuth Redirect URIs (Register in Developer Consoles)
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {accounts.map((acct) => (
                      <div
                        key={acct.platform}
                        className="rounded-lg bg-[#14141A] border border-[#24242F] p-2.5 space-y-1.5"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-semibold text-white">{acct.displayName}</span>
                          <a
                            href={acct.developerConsoleUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-[11px] text-blue-400 hover:text-blue-300"
                          >
                            Console
                            <ExternalLink className="w-3 h-3" />
                          </a>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <code className="text-[10px] font-mono text-zinc-300 truncate">
                            {acct.callbackUrl || apiUrl(`/api/social/callback/${acct.platform}`)}
                          </code>
                          <button
                            type="button"
                            onClick={() =>
                              copyText(
                                `cb-${acct.platform}`,
                                acct.callbackUrl ||
                                  apiUrl(`/api/social/callback/${acct.platform}`)
                              )
                            }
                            className="px-2 py-0.5 rounded bg-[#1E1E28] hover:bg-[#282836] text-[10px] text-zinc-200 shrink-0"
                          >
                            {copiedField === `cb-${acct.platform}` ? "Copied" : "Copy"}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: CALENDAR */}
      {activeTab === "calendar" && (
        <div className="rounded-xl bg-[#121216] border border-[#24242D] overflow-hidden">
          <div className="px-5 py-4 border-b border-[#22222A] flex items-center justify-between">
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <Calendar className="w-4 h-4 text-blue-400" />
              {monthLabel}
            </h2>
            <button
              type="button"
              onClick={() => setActiveTab("posts")}
              className="text-xs font-medium text-blue-400 hover:text-blue-300"
            >
              Manage Queue ({posts.length})
            </button>
          </div>
          <div className="grid grid-cols-7 border-b border-[#22222A] text-[11px] font-medium text-zinc-500 bg-[#0F0F13]">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
              <div key={d} className="py-2 px-3 text-center">
                {d}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 divide-x divide-y divide-[#1D1D24]">
            {Array.from({ length: firstDayOffset }).map((_, i) => (
              <div key={`empty-${i}`} className="min-h-[86px] bg-[#0C0C0F]" />
            ))}
            {Array.from({ length: daysInMonth }).map((_, idx) => {
              const dayNum = idx + 1;
              const datePrefix = `${year}-${String(month + 1).padStart(2, "0")}-${String(
                dayNum
              ).padStart(2, "0")}`;
              const dayPosts = posts.filter((p) => p.scheduledFor.startsWith(datePrefix));
              const isToday = dayNum === nowDate.getDate();
              return (
                <div
                  key={dayNum}
                  className={`min-h-[86px] p-2 space-y-1 ${
                    isToday ? "bg-blue-950/15" : "bg-[#111115]"
                  }`}
                >
                  <span
                    className={`inline-flex w-5 h-5 items-center justify-center rounded-full text-[11px] font-mono ${
                      isToday ? "bg-blue-600 text-white font-semibold" : "text-zinc-400"
                    }`}
                  >
                    {dayNum}
                  </span>
                  {dayPosts.slice(0, 2).map((dp) => (
                    <button
                      key={dp.id}
                      type="button"
                      onClick={() => setActiveTab("posts")}
                      className="w-full text-left px-1.5 py-0.5 rounded bg-[#1A1D28] hover:bg-[#232736] border border-[#2A3042] text-[10px] text-zinc-200 truncate block"
                    >
                      {dp.platform}: {dp.clipTitle}
                    </button>
                  ))}
                  {dayPosts.length > 2 && (
                    <p className="text-[10px] text-zinc-500 px-1">+{dayPosts.length - 2} more</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 3: POSTS */}
      {activeTab === "posts" && (
        <div className="space-y-5">
          {/* Auto-Upload Automation Settings */}
          <div className="rounded-xl bg-[#121216] border border-[#24242D] p-4 flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-6">
              <label className="inline-flex items-center gap-2.5 text-xs text-zinc-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoUploadEnabled}
                  onChange={onToggleAutoUpload}
                  className="accent-blue-600 w-4 h-4"
                />
                <span>Auto-upload scheduled clips when their publish time arrives</span>
              </label>

              <label className="inline-flex items-center gap-2.5 text-xs text-zinc-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoQueueTopClip}
                  onChange={onToggleAutoQueueTopClip}
                  className="accent-blue-600 w-4 h-4"
                />
                <span>Automatically queue #1 generated clip to connected channels</span>
              </label>
            </div>

            <button
              type="button"
              disabled={scheduledCount === 0 || Boolean(publishingPostId)}
              onClick={onRunDueUploads}
              className="px-3.5 py-1.5 rounded-lg bg-[#1A1A22] hover:bg-[#242430] disabled:opacity-40 border border-[#2C2C38] text-xs font-medium text-zinc-200 inline-flex items-center gap-1.5"
            >
              <UploadCloud className="w-3.5 h-3.5 text-blue-400" />
              Upload Due Now
            </button>
          </div>

          {/* Queue Table */}
          <div className="rounded-xl bg-[#121216] border border-[#24242D] overflow-hidden">
            <div className="px-5 py-4 border-b border-[#22222A] flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                <CalendarClock className="w-4 h-4 text-blue-400" />
                Publishing Queue
              </h2>
              <span className="text-xs font-mono tabular-nums text-zinc-500">
                {posts.length} items
              </span>
            </div>

            {posts.length === 0 ? (
              <div className="p-10 text-center text-xs text-zinc-500">
                No scheduled posts yet. Click Post on any generated clip to queue or publish it here.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-[#22222A] text-[11px] text-zinc-500">
                      <th className="py-3 px-4">Clip</th>
                      <th className="py-3 px-4">Channel</th>
                      <th className="py-3 px-4">Scheduled For</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1E1E25] text-xs">
                    {posts.map((post) => {
                      const isPublishing = publishingPostId === post.id;
                      return (
                        <tr key={post.id} className="hover:bg-[#17171D]">
                          <td className="py-3 px-4">
                            <p className="font-semibold text-white">{post.clipTitle}</p>
                            <p className="text-[11px] text-zinc-500 truncate max-w-sm">
                              {post.captionText}
                            </p>
                          </td>
                          <td className="py-3 px-4 text-zinc-300">{post.platform}</td>
                          <td className="py-3 px-4 font-mono tabular-nums text-zinc-400">
                            {post.scheduledFor}
                          </td>
                          <td className="py-3 px-4">
                            <span
                              className={`font-medium ${
                                post.status === "Published"
                                  ? "text-emerald-400"
                                  : "text-amber-400"
                              }`}
                            >
                              {isPublishing ? "Uploading..." : post.status}
                            </span>
                          </td>
                          <td className="py-3 px-4 text-right">
                            <div className="inline-flex items-center gap-2">
                              {post.status !== "Published" && (
                                <button
                                  type="button"
                                  disabled={Boolean(publishingPostId)}
                                  onClick={() => onPublishNow(post.id)}
                                  className="px-2.5 py-1 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-[11px] font-medium inline-flex items-center gap-1"
                                >
                                  {isPublishing && <Loader2 className="w-3 h-3 animate-spin" />}
                                  {isPublishing ? "Uploading" : "Publish Now"}
                                </button>
                              )}
                              <button
                                type="button"
                                disabled={isPublishing}
                                onClick={() => onDeletePost(post.id)}
                                aria-label="Remove post"
                                className="p-1 text-zinc-500 hover:text-red-400 disabled:opacity-40"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* 4. AI CLIPPING ASSISTANT & CLAUDE / CURSOR MCP CONNECT VIEW                */
/* -------------------------------------------------------------------------- */
interface AiAssistantViewProps {
  projects: VideoProject[];
  activeProject: VideoProject;
  onSelectProject: (id: string) => void;
  onApplyStyle: (projectId: string, style: CaptionStyleId) => void;
  onApplyAspect: (projectId: string, ratio: AspectRatio) => void;
  onOpenProjectClips: (projectId: string) => void;
}

export const AiAssistantView: React.FC<AiAssistantViewProps> = ({
  projects,
  activeProject,
  onSelectProject,
  onApplyStyle,
  onApplyAspect,
  onOpenProjectClips,
}) => {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: "m-init",
      role: "assistant",
      text: `Ready to clip "${activeProject.title}". Ask me to find your highest-scoring hook, switch all captions to Cyan Slide, change aspect ratio to 9:16 or 1:1, or summarize why top clips perform.`,
    },
  ]);
  const prevProjectIdRef = useRef(activeProject.id);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [copiedMcp, setCopiedMcp] = useState(false);

  useEffect(() => {
    if (prevProjectIdRef.current !== activeProject.id) {
      prevProjectIdRef.current = activeProject.id;
      setMessages([
        {
          id: `m-init-${activeProject.id}`,
          role: "assistant",
          text: `Switched to "${activeProject.title}" (${activeProject.clips.length} clips). Ask me to restyle captions, change aspect ratio, or analyze your strongest hook.`,
        },
      ]);
    }
  }, [activeProject.id, activeProject.title, activeProject.clips.length]);

  const mcpSnippet = JSON.stringify(
    {
      mcpServers: {
        scalereach: {
          command: "npx",
          args: ["-y", "@scalereach/mcp-server"],
          env: {
            SCALEREACH_WORKSPACE: "md-workspace",
          },
        },
      },
    },
    null,
    2
  );

  const sendPrompt = async (promptText?: string) => {
    const text = (promptText ?? input).trim();
    if (!text || loading) return;
    if (!promptText) setInput("");

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: "user",
      text,
    };
    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    try {
      const res = await fetch(apiUrl("/api/assistant/chat"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          projectContext: {
            projectTitle: activeProject.title,
            aspectRatio: activeProject.aspectRatio,
            captionStyle: activeProject.captionStyle,
            clips: activeProject.clips.map((c) => ({
              id: c.id,
              rank: c.rank,
              title: c.title,
              viralityScore: c.viralityScore,
              durationSec: c.durationSec,
              whyViral: c.whyViral,
            })),
          },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Assistant request failed");

      let actionSummary = "";
      const act = data.action;
      const validStyles = new Set<string>(CAPTION_STYLES.map((s) => s.id));
      const validAspects = new Set<string>(["9:16", "16:9", "1:1"]);
      if (act && act.type === "switch_style" && validStyles.has(String(act.captionStyle || ""))) {
        onApplyStyle(activeProject.id, act.captionStyle as CaptionStyleId);
        actionSummary = `Applied caption style: ${act.captionStyle}`;
      } else if (
        act &&
        act.type === "switch_aspect" &&
        validAspects.has(String(act.aspectRatio || ""))
      ) {
        onApplyAspect(activeProject.id, act.aspectRatio as AspectRatio);
        actionSummary = `Switched aspect ratio to ${act.aspectRatio}`;
      } else if (act && act.type === "open_clip_editor") {
        onOpenProjectClips(activeProject.id);
        actionSummary = `Opened clips workspace for ${activeProject.title}`;
      } else if (act && act.type === "translate_clip" && act.targetLanguage) {
        actionSummary = `Open any clip's Translate tab to translate into ${act.targetLanguage}`;
      } else if (act && act.type === "filter_score" && typeof act.minScore === "number") {
        const count = activeProject.clips.filter((c) => c.viralityScore >= act.minScore).length;
        actionSummary = `${count} clip(s) meet score >= ${act.minScore}`;
      }

      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          text: data.reply,
          actionSummary,
        },
      ]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: `err-${Date.now()}`,
          role: "assistant",
          text: err instanceof Error ? err.message : "Could not reach assistant.",
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-[1200px] mx-auto px-6 py-8 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-white">AI Clip Assistant</h1>
          <p className="text-xs text-zinc-400 mt-1">
            Clip, restyle, and audit video moments by chatting — or connect Claude & Cursor via MCP.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <select
            value={activeProject.id}
            onChange={(e) => onSelectProject(e.target.value)}
            aria-label="Target project"
            className="bg-[#141419] border border-[#262630] rounded-lg px-3 py-1.5 text-xs text-white max-w-[260px]"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => onOpenProjectClips(activeProject.id)}
            className="px-3 py-1.5 rounded-lg bg-[#18181F] hover:bg-[#23232D] border border-[#2C2C38] text-xs font-medium text-zinc-200 whitespace-nowrap"
          >
            Open Clips
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Chat Interface */}
        <div className="lg:col-span-7 rounded-xl bg-[#121216] border border-[#24242D] flex flex-col h-[520px]">
          <div className="p-4 border-b border-[#22222A] flex flex-wrap gap-2">
            {[
              "Switch captions to Cyan Slide",
              "Which clip has the strongest hook and why?",
              "Change aspect ratio to 1:1 square",
            ].map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => sendPrompt(q)}
                className="px-2.5 py-1 rounded-md bg-[#18181F] hover:bg-[#22222C] border border-[#282834] text-[11px] text-zinc-300 transition-colors"
              >
                {q}
              </button>
            ))}
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.map((m) => (
              <div
                key={m.id}
                className={`flex flex-col ${
                  m.role === "user" ? "items-end" : "items-start"
                }`}
              >
                <div
                  className={`max-w-[85%] rounded-lg px-3.5 py-2.5 text-xs leading-relaxed ${
                    m.role === "user"
                      ? "bg-blue-600 text-white"
                      : "bg-[#191921] border border-[#262630] text-zinc-200"
                  }`}
                >
                  {m.text}
                </div>
                {m.actionSummary && (
                  <span className="mt-1 text-[11px] text-emerald-400 font-mono">
                    {m.actionSummary}
                  </span>
                )}
              </div>
            ))}
            {loading && (
              <div className="flex items-center gap-2 text-xs text-zinc-400">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />
                Analyzing clips...
              </div>
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              sendPrompt();
            }}
            className="p-3 border-t border-[#22222A] flex items-center gap-2"
          >
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask to restyle captions, switch aspect ratio, or analyze hooks..."
              className="flex-1 px-3 py-2 rounded-lg bg-[#17171D] border border-[#272731] focus:border-blue-500 focus:outline-none text-xs text-white placeholder:text-zinc-500"
            />
            <button
              type="submit"
              disabled={!input.trim() || loading}
              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-xs font-semibold text-white inline-flex items-center gap-1.5"
            >
              <Bot className="w-3.5 h-3.5" />
              Send
            </button>
          </form>
        </div>

        {/* Claude / Cursor MCP Integration Card */}
        <div className="lg:col-span-5 rounded-xl bg-[#121216] border border-[#24242D] p-5 space-y-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-white">
            <Terminal className="w-4 h-4 text-blue-400" />
            Connect Claude or Cursor (MCP)
          </div>
          <p className="text-xs text-zinc-400 leading-relaxed">
            Add ScaleReach to your Claude Desktop or Cursor MCP configuration to clip YouTube links, restyle captions, and export Shorts directly from your AI workspace.
          </p>

          <div className="relative">
            <pre className="p-3.5 rounded-lg bg-[#0A0A0C] border border-[#22222A] text-[11px] font-mono text-zinc-300 overflow-x-auto">
              {mcpSnippet}
            </pre>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard?.writeText(mcpSnippet);
                setCopiedMcp(true);
                setTimeout(() => setCopiedMcp(false), 1800);
              }}
              className="mt-2.5 w-full py-2 rounded-lg bg-[#1A1A22] hover:bg-[#23232E] border border-[#2C2C37] text-xs font-medium text-zinc-200 inline-flex items-center justify-center gap-1.5"
            >
              {copiedMcp ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  Copied MCP Config
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  Copy MCP Config JSON
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
