import { ClipItem, ScheduledPost, VideoProject } from "../types";

export function normalizeHashtag(raw: string): string {
  const cleaned = raw
    .trim()
    .replace(/^#+/, "")
    .replace(/[^\p{L}\p{N}_]/gu, "");
  return cleaned ? `#${cleaned}` : "";
}

export function deriveFallbackHashtags(
  clip: ClipItem,
  project: VideoProject,
  platform: ScheduledPost["platform"] = "TikTok"
): string[] {
  const stopWords = new Set([
    "about",
    "after",
    "being",
    "could",
    "every",
    "first",
    "found",
    "going",
    "great",
    "never",
    "other",
    "people",
    "really",
    "right",
    "should",
    "since",
    "still",
    "their",
    "there",
    "these",
    "thing",
    "think",
    "those",
    "three",
    "today",
    "under",
    "using",
    "video",
    "watch",
    "where",
    "which",
    "while",
    "world",
    "would",
    "years",
    "your",
  ]);

  const sourceText = `${project.clipType} ${project.title} ${clip.title} ${
    clip.videoCategory || ""
  }`;
  const words = sourceText
    .toLowerCase()
    .split(/[^a-z0-9\p{L}]+/u)
    .filter((w) => w.length >= 4 && !stopWords.has(w));

  const tags: string[] = [];
  for (const w of words) {
    const tag = normalizeHashtag(w);
    if (tag && !tags.includes(tag)) {
      tags.push(tag);
    }
    if (tags.length >= 4) break;
  }

  const platformDefaults: Record<ScheduledPost["platform"], string[]> = {
    TikTok: ["#fyp", "#viralclips", "#tiktok"],
    "Instagram Reels": ["#reels", "#instareels", "#explore"],
    "YouTube Shorts": ["#shorts", "#youtubeshorts", "#viralshorts"],
    LinkedIn: ["#insights", "#leadership", "#linkedin"],
    Facebook: ["#facebook", "#reels", "#creator"],
  };

  for (const pTag of platformDefaults[platform]) {
    if (!tags.includes(pTag)) {
      tags.push(pTag);
    }
    if (tags.length >= 6) break;
  }

  return tags;
}

export function getClipHashtags(
  clip: ClipItem,
  project: VideoProject,
  platform: ScheduledPost["platform"] = "TikTok"
): string[] {
  if (Array.isArray(clip.hashtags) && clip.hashtags.length > 0) {
    const normalized = clip.hashtags.map(normalizeHashtag).filter(Boolean);
    if (normalized.length > 0) return normalized;
  }
  return deriveFallbackHashtags(clip, project, platform);
}

export function buildSocialCaptionWithTags(
  clip: ClipItem,
  project: VideoProject,
  platform: ScheduledPost["platform"] = "TikTok"
): string {
  const excerpt = clip.transcript[0]?.text ?? "";
  const tags = getClipHashtags(clip, project, platform).join(" ");
  const headline = excerpt ? `${clip.title} — ${excerpt}` : clip.title;
  return tags ? `${headline}\n\n${tags}` : headline;
}
