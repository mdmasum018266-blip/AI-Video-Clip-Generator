export type AppRoute =
  | "home"
  | "configure"
  | "processing"
  | "clips"
  | "all-clips"
  | "favorites"
  | "brand-templates"
  | "social-scheduler"
  | "ai-assistant";

export type AspectRatio = "9:16" | "16:9" | "1:1";

export type CaptionStyleId =
  | "classic"
  | "cyan-slide"
  | "italic-red"
  | "red-spin"
  | "violet"
  | "blue-glow"
  | "emerald-pop"
  | "minimal-serif";

export interface CaptionStyleMeta {
  id: CaptionStyleId;
  name: string;
  sampleTop: string;
  sampleBottom: string;
  description: string;
}

export interface TranscriptCue {
  id: string;
  startOffsetSec: number;
  endOffsetSec: number;
  text: string;
  emphasisWords: string[];
}

export interface ClipItem {
  id: string;
  projectId: string;
  rank: number;
  title: string;
  hookTitle: string;
  startTimeSec: number;
  endTimeSec: number;
  durationSec: number;
  viralityScore: number;
  hookStrength: number;
  pacingScore: number;
  whyViral: string;
  resolution: "1080p" | "720p";
  aspectRatio: AspectRatio;
  captionStyle: CaptionStyleId;
  showAutoHook: boolean;
  focalPointX: number; // 0 to 100 (%) for speaker reframing
  zoomScale: number; // 1.0 to 2.0
  splitScreen: boolean;
  splitScreenBgId?: string;
  language: string;
  isFavorite: boolean;
  videoCategory?: string;
  hashtags?: string[];
  transcript: TranscriptCue[];
}

export interface VideoProject {
  id: string;
  title: string;
  channel: string;
  sourceType: "youtube" | "upload" | "twitch" | "drive" | "direct";
  url?: string;
  youtubeId?: string;
  localVideoUrl?: string;
  thumbnailUrl: string;
  durationSec: number;
  createdAt: string;
  clipType: string;
  language: string;
  aspectRatio: AspectRatio;
  captionStyle: CaptionStyleId;
  autoHook: boolean;
  splitScreen: boolean;
  splitScreenBgId?: string;
  isDemo?: boolean;
  clips: ClipItem[];
}

export interface BackgroundVideoOption {
  id: string;
  name: string;
  category: "GTA 5" | "Minecraft" | "Subway Surfer" | "ASMR";
  durationLabel: string;
  thumbnailUrl: string;
}

export interface BrandTemplate {
  id: string;
  name: string;
  captionStyle: CaptionStyleId;
  aspectRatio: AspectRatio;
  autoHook: boolean;
  accentHex: string;
  watermarkHandle: string;
  splitScreen: boolean;
}

export interface ScheduledPost {
  id: string;
  clipId: string;
  clipTitle: string;
  projectTitle: string;
  thumbnailUrl: string;
  platform: "TikTok" | "Instagram Reels" | "YouTube Shorts" | "LinkedIn" | "Facebook";
  scheduledFor: string;
  captionText: string;
  status: "Scheduled" | "Published" | "Draft";
}

export interface UsageEntry {
  id: string;
  projectTitle: string;
  date: string;
  minutesProcessed: number;
  clipsGenerated: number;
  sourceType: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  actionSummary?: string;
}

export type SocialPlatformKey = "tiktok" | "instagram" | "youtube" | "linkedin" | "facebook";

export interface SocialAccountStatus {
  platform: SocialPlatformKey;
  displayName: "TikTok" | "Instagram Reels" | "YouTube Shorts" | "LinkedIn" | "Facebook";
  connected: boolean;
  configured: boolean;
  accountName?: string;
  accountHandle?: string;
  callbackUrl: string;
  sharedCallbackUrl?: string;
  requiredEnvVars: [string, string];
  envStatus?: {
    keyConfigured: boolean;
    secretConfigured: boolean;
  };
  developerConsoleUrl: string;
}

