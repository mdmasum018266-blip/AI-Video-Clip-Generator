import React, { useMemo, useState } from "react";
import {
  X,
  CalendarClock,
  Send,
  Loader2,
  AlertCircle,
  Link2,
  Sparkles,
  Hash,
} from "lucide-react";
import { ClipItem, ScheduledPost, SocialAccountStatus, VideoProject } from "../types";
import {
  buildSocialCaptionWithTags,
  getClipHashtags,
  normalizeHashtag,
} from "../utils/hashtags";
import { apiUrl } from "../utils/api";

interface PostModalProps {
  clip: ClipItem;
  project: VideoProject;
  accounts: SocialAccountStatus[];
  initialPlatform?: ScheduledPost["platform"];
  onSchedule: (post: ScheduledPost) => void;
  onPublishNow: (post: ScheduledPost) => Promise<void>;
  onConnectPlatform: (platformName: ScheduledPost["platform"]) => void;
  onUpdateClip?: (clip: ClipItem) => void;
  onClose: () => void;
}

function getDefaultScheduleInput(): string {
  const dt = new Date(Date.now() + 15 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}T${pad(
    dt.getHours()
  )}:${pad(dt.getMinutes())}`;
}

export const PostModal: React.FC<PostModalProps> = ({
  clip,
  project,
  accounts,
  initialPlatform = "TikTok",
  onSchedule,
  onPublishNow,
  onConnectPlatform,
  onUpdateClip,
  onClose,
}) => {
  const [platform, setPlatform] = useState<ScheduledPost["platform"]>(initialPlatform);
  const [scheduledFor, setScheduledFor] = useState(getDefaultScheduleInput);
  const [hashtags, setHashtags] = useState<string[]>(() =>
    getClipHashtags(clip, project, initialPlatform)
  );
  const [captionText, setCaptionText] = useState(() =>
    buildSocialCaptionWithTags(clip, project, initialPlatform)
  );
  const [captionEdited, setCaptionEdited] = useState(false);
  const [isGeneratingTags, setIsGeneratingTags] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedAccount = useMemo(
    () => accounts.find((a) => a.displayName === platform),
    [accounts, platform]
  );

  const handlePlatformChange = (nextPlatform: ScheduledPost["platform"]) => {
    setPlatform(nextPlatform);
    setError(null);
    if (!captionEdited) {
      const nextTags = getClipHashtags(clip, project, nextPlatform);
      setHashtags(nextTags);
      setCaptionText(buildSocialCaptionWithTags(clip, project, nextPlatform));
    }
  };

  const handleGenerateTags = async () => {
    setIsGeneratingTags(true);
    setError(null);
    try {
      const res = await fetch(apiUrl("/api/clips/hashtags"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: clip.title,
          projectTitle: project.title,
          clipType: project.clipType,
          language: clip.language,
          platform,
          transcriptText: clip.transcript.map((t) => t.text).join(" "),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not generate hashtags");

      const cleaned = (Array.isArray(data.hashtags) ? data.hashtags : [])
        .map(normalizeHashtag)
        .filter(Boolean);
      if (cleaned.length > 0) {
        setHashtags(cleaned);
        const excerpt = clip.transcript[0]?.text ?? "";
        const headline = excerpt ? `${clip.title} — ${excerpt}` : clip.title;
        setCaptionText(
          data.suggestedCaption && !captionEdited
            ? String(data.suggestedCaption)
            : `${headline}\n\n${cleaned.join(" ")}`
        );
        if (onUpdateClip) {
          onUpdateClip({
            ...clip,
            videoCategory: data.videoCategory || clip.videoCategory,
            hashtags: cleaned,
          });
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not generate hashtags.");
    } finally {
      setIsGeneratingTags(false);
    }
  };

  const handleAppendTag = (tag: string) => {
    if (captionText.includes(tag)) return;
    setCaptionEdited(true);
    setCaptionText((prev) => `${prev.trim()} ${tag}`.trim());
  };

  const handleQueue = () => {
    const formatted = scheduledFor.replace("T", " ");
    onSchedule({
      id: `post-${Date.now()}`,
      clipId: clip.id,
      clipTitle: clip.title,
      projectTitle: project.title,
      thumbnailUrl: project.thumbnailUrl,
      platform,
      scheduledFor: formatted,
      captionText,
      status: "Scheduled",
    });
    onClose();
  };

  const handlePublish = async () => {
    setError(null);
    if (!selectedAccount?.connected) {
      setError(`${platform} is not connected yet. Connect your account first to upload directly.`);
      return;
    }

    setIsPublishing(true);
    try {
      await onPublishNow({
        id: `post-${Date.now()}`,
        clipId: clip.id,
        clipTitle: clip.title,
        projectTitle: project.title,
        thumbnailUrl: project.thumbnailUrl,
        platform,
        scheduledFor: "Published immediately",
        captionText,
        status: "Scheduled",
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed. Please try again.");
    } finally {
      setIsPublishing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-xs p-4">
      <div className="w-full max-w-lg rounded-xl bg-[#121216] border border-[#272731] overflow-hidden shadow-2xl">
        <div className="px-5 py-4 border-b border-[#22222A] flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-white">Schedule or Publish Clip</h2>
            <p className="text-xs text-zinc-400 truncate mt-0.5">{clip.title}</p>
          </div>
          <button
            type="button"
            disabled={isPublishing}
            onClick={onClose}
            aria-label="Close publish modal"
            className="p-1.5 text-zinc-400 hover:text-white disabled:opacity-40"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {error && (
            <div className="rounded-lg bg-red-950/35 border border-red-900/60 p-3 flex items-start justify-between gap-3 text-xs text-red-200">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
              {!selectedAccount?.connected && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onConnectPlatform(platform);
                  }}
                  className="px-2.5 py-1 rounded bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-medium shrink-0 inline-flex items-center gap-1"
                >
                  <Link2 className="w-3 h-3" />
                  Connect
                </button>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-zinc-300">Destination Channel</label>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  "TikTok",
                  "Instagram Reels",
                  "YouTube Shorts",
                  "LinkedIn",
                  "Facebook",
                ] as ScheduledPost["platform"][]
              ).map((p) => {
                const acct = accounts.find((a) => a.displayName === p);
                const isConnected = Boolean(acct?.connected);
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => handlePlatformChange(p)}
                    className={`px-3 py-2 rounded-lg border text-left transition-colors flex items-center justify-between gap-2 ${
                      platform === p
                        ? "bg-blue-600/20 border-blue-500 text-white"
                        : "bg-[#17171D] border-[#272731] text-zinc-400 hover:text-white"
                    }`}
                  >
                    <span className="text-xs font-medium truncate">{p}</span>
                    <span
                      className={`text-[10px] font-medium shrink-0 ${
                        isConnected ? "text-emerald-400" : "text-zinc-500"
                      }`}
                    >
                      {isConnected ? "Connected" : "Connect"}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <label htmlFor="post-caption" className="text-xs font-medium text-zinc-300">
                Social Caption & Auto #Hashtags
              </label>
              <button
                type="button"
                disabled={isGeneratingTags}
                onClick={handleGenerateTags}
                className="px-2.5 py-1 rounded bg-[#1B1B24] hover:bg-[#252532] border border-[#2D2D3B] text-[11px] font-medium text-blue-300 inline-flex items-center gap-1 disabled:opacity-50"
              >
                {isGeneratingTags ? (
                  <Loader2 className="w-3 h-3 animate-spin" />
                ) : (
                  <Sparkles className="w-3 h-3" />
                )}
                {isGeneratingTags ? "Generating..." : "AI Generate #Tags"}
              </button>
            </div>
            <textarea
              id="post-caption"
              rows={4}
              value={captionText}
              onChange={(e) => {
                setCaptionEdited(true);
                setCaptionText(e.target.value);
              }}
              className="w-full rounded-lg bg-[#17171D] border border-[#272731] focus:border-blue-500 focus:outline-none p-3 text-xs text-white"
            />
            {hashtags.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <Hash className="w-3 h-3 text-zinc-500 shrink-0" />
                {hashtags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => handleAppendTag(tag)}
                    className="px-2 py-0.5 rounded bg-[#171720] hover:bg-[#22222F] border border-[#282834] text-[11px] font-mono text-blue-300"
                  >
                    {tag}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-1.5">
            <label htmlFor="post-time" className="text-xs font-medium text-zinc-300">
              Auto-Upload Date & Time
            </label>
            <input
              id="post-time"
              type="datetime-local"
              value={scheduledFor}
              onChange={(e) => setScheduledFor(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-[#17171D] border border-[#272731] focus:border-blue-500 focus:outline-none text-xs font-mono tabular-nums text-white"
            />
          </div>
        </div>

        <div className="px-5 py-3.5 border-t border-[#22222A] flex items-center justify-end gap-2.5">
          <button
            type="button"
            disabled={isPublishing}
            onClick={handleQueue}
            className="px-4 py-2 rounded-lg bg-[#1A1A22] hover:bg-[#23232D] border border-[#2C2C38] text-xs font-medium text-zinc-200 disabled:opacity-40 inline-flex items-center gap-1.5"
          >
            <CalendarClock className="w-3.5 h-3.5 text-blue-400" />
            Add to Auto-Queue
          </button>
          <button
            type="button"
            disabled={isPublishing}
            onClick={handlePublish}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-xs font-semibold text-white inline-flex items-center gap-1.5"
          >
            {isPublishing ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                Rendering & Uploading...
              </>
            ) : (
              <>
                <Send className="w-3.5 h-3.5" />
                Publish Now
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
};

