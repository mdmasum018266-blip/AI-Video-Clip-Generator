import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PanelLeft, ChevronRight, Cloud, AlertCircle, X } from "lucide-react";
import { onAuthStateChanged, User } from "firebase/auth";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import {
  auth,
  db,
  handleFirestoreError,
  isUserAdmin,
  OperationType,
  signInWithGoogleAccount,
  signOutAccount,
} from "./firebase";
import {
  deleteBrandTemplateFromCloud,
  deleteScheduledPostFromCloud,
  ensureUserProfile,
  saveBrandTemplateToCloud,
  saveProjectToCloud,
  saveScheduledPostToCloud,
  saveUsageEntryToCloud,
  seedCloudWorkspaceIfEmpty,
  updateUserPreferencesInCloud,
} from "./services/workspaceSync";
import {
  AppRoute,
  AspectRatio,
  BrandTemplate,
  CaptionStyleId,
  ClipItem,
  ScheduledPost,
  SocialAccountStatus,
  SocialPlatformKey,
  UsageEntry,
  VideoProject,
} from "./types";
import {
  DEMO_PROJECTS,
  INITIAL_BRAND_TEMPLATES,
  INITIAL_SCHEDULED_POSTS,
  INITIAL_USAGE_HISTORY,
} from "./data/presets";
import { blobToBase64, renderWebmClipBlob } from "./utils/exportClip";
import { buildSocialCaptionWithTags, normalizeHashtag } from "./utils/hashtags";
import { Sidebar } from "./components/Sidebar";
import { HomeView } from "./components/HomeView";
import {
  ConfigureSubmitPayload,
  ConfigureView,
  DraftVideoSource,
} from "./components/ConfigureView";
import { ClipsView } from "./components/ClipsView";
import { ClipEditorModal } from "./components/ClipEditorModal";
import { PostModal } from "./components/PostModal";
import { ProcessingMeta, ProcessingView } from "./components/ProcessingView";
import {
  AiAssistantView,
  BrandTemplatesView,
  LibraryClipsView,
  SocialSchedulerView,
} from "./components/ToolsViews";

const STORAGE_KEY = "scalereach_workspace_v1";

const DEFAULT_SOCIAL_ACCOUNTS: SocialAccountStatus[] = [
  {
    platform: "tiktok",
    displayName: "TikTok",
    connected: false,
    configured: false,
    callbackUrl: "",
    requiredEnvVars: ["TIKTOK_CLIENT_KEY", "TIKTOK_CLIENT_SECRET"],
    developerConsoleUrl: "https://developers.tiktok.com/apps/",
  },
  {
    platform: "instagram",
    displayName: "Instagram Reels",
    connected: false,
    configured: false,
    callbackUrl: "",
    requiredEnvVars: ["INSTAGRAM_CLIENT_ID", "INSTAGRAM_CLIENT_SECRET"],
    developerConsoleUrl: "https://developers.facebook.com/apps/",
  },
  {
    platform: "youtube",
    displayName: "YouTube Shorts",
    connected: false,
    configured: false,
    callbackUrl: "",
    requiredEnvVars: ["YOUTUBE_CLIENT_ID", "YOUTUBE_CLIENT_SECRET"],
    developerConsoleUrl: "https://console.cloud.google.com/apis/credentials",
  },
  {
    platform: "linkedin",
    displayName: "LinkedIn",
    connected: false,
    configured: false,
    callbackUrl: "",
    requiredEnvVars: ["LINKEDIN_CLIENT_ID", "LINKEDIN_CLIENT_SECRET"],
    developerConsoleUrl: "https://www.linkedin.com/developers/apps",
  },
  {
    platform: "facebook",
    displayName: "Facebook",
    connected: false,
    configured: false,
    callbackUrl: "",
    requiredEnvVars: ["FACEBOOK_CLIENT_ID", "FACEBOOK_CLIENT_SECRET"],
    developerConsoleUrl: "https://developers.facebook.com/apps/",
  },
];

function formatNowLocal(): string {
  const dt = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())} ${pad(
    dt.getHours()
  )}:${pad(dt.getMinutes())}`;
}

function isPostDue(scheduledFor: string): boolean {
  const normalized = scheduledFor.trim().replace(" ", "T");
  const parsed = Date.parse(normalized);
  if (Number.isNaN(parsed)) return false;
  return parsed <= Date.now();
}

const GEMINI_SUPPORTED_MIME = new Set([
  "video/mp4",
  "video/mpeg",
  "video/mov",
  "video/quicktime",
  "video/avi",
  "video/x-msvideo",
  "video/x-flv",
  "video/mpg",
  "video/webm",
  "video/wmv",
  "video/3gpp",
  "audio/wav",
  "audio/x-wav",
  "audio/mp3",
  "audio/mpeg",
  "audio/aac",
  "audio/ogg",
  "audio/flac",
  "audio/webm",
  "audio/mp4",
  "audio/x-m4a",
]);

function inferGeminiMimeType(file: File): string | undefined {
  const raw = (file.type || "").toLowerCase().split(";")[0].trim();
  if (raw === "video/x-msvideo") return "video/avi";
  if (raw && GEMINI_SUPPORTED_MIME.has(raw)) return raw;
  const ext = file.name.split(".").pop()?.toLowerCase() || "";
  const extMap: Record<string, string> = {
    mp4: "video/mp4",
    mov: "video/quicktime",
    webm: "video/webm",
    avi: "video/avi",
    mpg: "video/mpg",
    mpeg: "video/mpeg",
    "3gp": "video/3gpp",
    mp3: "audio/mp3",
    wav: "audio/wav",
    m4a: "audio/mp4",
    aac: "audio/aac",
    ogg: "audio/ogg",
    flac: "audio/flac",
  };
  return extMap[ext];
}

async function fetchWithTimeout(
  input: RequestInfo,
  init: RequestInit,
  timeoutMs: number,
  timeoutMessage: string
): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw new Error(timeoutMessage);
    }
    throw err;
  } finally {
    window.clearTimeout(timer);
  }
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const idx = result.indexOf(",");
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.onerror = () => reject(new Error("Could not read media file."));
    reader.readAsDataURL(file);
  });
}

function inspectLocalMedia(
  file: File,
  objectUrl: string
): Promise<{ durationSec: number; thumbnailUrl: string }> {
  const fallbackThumb = "/src/assets/images/demo_creator_editing_1795261138677.jpg";
  const audioThumb = "/src/assets/images/demo_podcast_ai_1795261139145.jpg";

  return new Promise((resolve) => {
    const isVideo =
      file.type.startsWith("video/") ||
      /\.(mp4|mov|webm|mkv|avi|m4v|3gp|ogv)$/i.test(file.name);
    const el = document.createElement(isVideo ? "video" : "audio");
    el.preload = "metadata";
    el.muted = true;
    el.src = objectUrl;

    let settled = false;
    let knownDuration = 300;

    const cleanup = () => {
      el.onloadedmetadata = null;
      el.onerror = null;
      if (isVideo) {
        const vid = el as HTMLVideoElement;
        vid.onseeked = null;
        vid.onloadeddata = null;
      }
      try {
        el.removeAttribute("src");
        el.load();
      } catch {
        // Ignore cleanup errors
      }
    };

    const finish = (durationSec: number, thumbnailUrl: string) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      cleanup();
      resolve({
        durationSec:
          Number.isFinite(durationSec) && durationSec > 0
            ? Math.max(15, Math.round(durationSec))
            : 300,
        thumbnailUrl: thumbnailUrl || fallbackThumb,
      });
    };

    const timeoutId = window.setTimeout(() => {
      finish(knownDuration, isVideo ? fallbackThumb : audioThumb);
    }, 4000);

    const captureFrame = (vid: HTMLVideoElement, dur: number) => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = 640;
        canvas.height = 360;
        const ctx = canvas.getContext("2d");
        if (ctx && vid.videoWidth > 0 && vid.videoHeight > 0) {
          ctx.drawImage(vid, 0, 0, canvas.width, canvas.height);
          finish(dur, canvas.toDataURL("image/jpeg", 0.8));
          return;
        }
      } catch {
        // Ignore tainted canvas
      }
      finish(dur, fallbackThumb);
    };

    el.onloadedmetadata = () => {
      const dur =
        Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 300;
      knownDuration = dur;

      if (!isVideo) {
        finish(dur, audioThumb);
        return;
      }

      const vid = el as HTMLVideoElement;
      const seekTarget = dur > 1.5 ? Math.min(2, dur / 3) : 0;

      vid.onseeked = () => captureFrame(vid, dur);
      vid.onloadeddata = () => {
        if (seekTarget <= 0.05) {
          captureFrame(vid, dur);
        }
      };

      if (seekTarget > 0.05) {
        try {
          vid.currentTime = seekTarget;
        } catch {
          finish(dur, fallbackThumb);
        }
      } else if (vid.readyState >= 2) {
        captureFrame(vid, dur);
      }
    };

    el.onerror = () => {
      finish(knownDuration, isVideo ? fallbackThumb : audioThumb);
    };
  });
}

export default function App() {
  const [route, setRoute] = useState<AppRoute>("home");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [projects, setProjects] = useState<VideoProject[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed.projects) && parsed.projects.length > 0) {
          return parsed.projects;
        }
      }
    } catch {
      // Fallback to defaults
    }
    return DEMO_PROJECTS;
  });

  const [brandTemplates, setBrandTemplates] = useState<BrandTemplate[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed.brandTemplates)) return parsed.brandTemplates;
      }
    } catch {
      // Ignore
    }
    return INITIAL_BRAND_TEMPLATES;
  });

  const [scheduledPosts, setScheduledPosts] = useState<ScheduledPost[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed.scheduledPosts)) return parsed.scheduledPosts;
      }
    } catch {
      // Ignore
    }
    return INITIAL_SCHEDULED_POSTS;
  });

  const [usageHistory, setUsageHistory] = useState<UsageEntry[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed.usageHistory)) return parsed.usageHistory;
      }
    } catch {
      // Ignore
    }
    return INITIAL_USAGE_HISTORY;
  });

  const [activeProjectId, setActiveProjectId] = useState<string>(projects[0]?.id ?? "");
  const [draftSource, setDraftSource] = useState<DraftVideoSource | null>(null);

  const [isInspecting, setIsInspecting] = useState(false);
  const [quickGeneratingLabel, setQuickGeneratingLabel] = useState<string | null>(null);
  const [inspectError, setInspectError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);

  const [processingMeta, setProcessingMeta] = useState<ProcessingMeta | null>(null);
  const [processingStep, setProcessingStep] = useState<number>(1);
  const [processingPct, setProcessingPct] = useState<number>(10);

  const [editingClip, setEditingClip] = useState<{
    clip: ClipItem;
    project: VideoProject;
  } | null>(null);
  const [postingClip, setPostingClip] = useState<{
    clip: ClipItem;
    project: VideoProject;
    platform?: ScheduledPost["platform"];
  } | null>(null);

  const [socialAccounts, setSocialAccounts] = useState<SocialAccountStatus[]>(
    DEFAULT_SOCIAL_ACCOUNTS
  );
  const [schedulerTab, setSchedulerTab] = useState<"calendar" | "accounts" | "posts">("accounts");
  const [connectingPlatform, setConnectingPlatform] = useState<SocialPlatformKey | null>(null);
  const [setupGuideAccount, setSetupGuideAccount] = useState<SocialAccountStatus | null>(null);
  const [oauthError, setOauthError] = useState<string | null>(null);
  const [publishingPostId, setPublishingPostId] = useState<string | null>(null);
  const [publishStatusText, setPublishStatusText] = useState<string | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);

  const [autoUploadEnabled, setAutoUploadEnabled] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (typeof parsed.autoUploadEnabled === "boolean") return parsed.autoUploadEnabled;
      }
    } catch {
      // Ignore
    }
    return true;
  });

  const [autoQueueTopClip, setAutoQueueTopClip] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (typeof parsed.autoQueueTopClip === "boolean") return parsed.autoQueueTopClip;
      }
    } catch {
      // Ignore
    }
    return true;
  });

  const [authUser, setAuthUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const publishingLockRef = useRef(false);
  const activeGenTokenRef = useRef(0);
  const localVideoUrlMapRef = useRef<Record<string, string>>({});
  const localThumbnailMapRef = useRef<Record<string, string>>({});
  const pendingCloudProjectsRef = useRef<Map<string, VideoProject>>(new Map());

  const isAdmin = useMemo(() => isUserAdmin(authUser), [authUser]);

  const handleSignInGoogle = useCallback(async () => {
    setAuthLoading(true);
    setAuthError(null);
    try {
      await signInWithGoogleAccount();
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not sign in with Google.";
      setAuthError(msg);
      setOauthError(msg);
    } finally {
      setAuthLoading(false);
    }
  }, []);

  const handleSignOut = useCallback(async () => {
    await signOutAccount();
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setAuthUser(user);
      setAuthReady(true);
      if (!user) {
        pendingCloudProjectsRef.current.clear();
        setAuthError(null);
        return;
      }
      if (user && user.emailVerified) {
        try {
          const cloudPrefs = await ensureUserProfile(user, {
            autoUploadEnabled,
            autoQueueTopClip,
          });
          setAutoUploadEnabled(cloudPrefs.autoUploadEnabled);
          setAutoQueueTopClip(cloudPrefs.autoQueueTopClip);
          await seedCloudWorkspaceIfEmpty(
            user.uid,
            DEMO_PROJECTS,
            INITIAL_BRAND_TEMPLATES,
            INITIAL_USAGE_HISTORY
          );
        } catch (err) {
          console.error("Profile initialization error:", err);
        }
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!authReady || !authUser || !authUser.emailVerified) return;
    const uid = authUser.uid;

    const projectsPath = `users/${uid}/projects`;
    const unsubProjects = onSnapshot(
      query(collection(db, "users", uid, "projects"), orderBy("createdAt", "desc")),
      (snap) => {
        const pendingMap = pendingCloudProjectsRef.current;
        if (snap.empty && pendingMap.size === 0) return;

        const next: VideoProject[] = snap.docs.map((d) => {
          const data = d.data();
          const id = String(data.id || d.id);
          pendingMap.delete(id);
          return {
            id,
            title: String(data.title || "Untitled Project"),
            channel: String(data.channel || "Creator"),
            sourceType: (data.sourceType || "youtube") as VideoProject["sourceType"],
            url: data.url ? String(data.url) : undefined,
            youtubeId: data.youtubeId ? String(data.youtubeId) : undefined,
            localVideoUrl: localVideoUrlMapRef.current[id],
            thumbnailUrl: localThumbnailMapRef.current[id] || String(data.thumbnailUrl || ""),
            durationSec: Number(data.durationSec) || 0,
            createdAt: String(data.createdAtLabel || "Today"),
            clipType: String(data.clipType || "Viral Clips"),
            language: String(data.language || "English"),
            aspectRatio: (data.aspectRatio || "9:16") as AspectRatio,
            captionStyle: (data.captionStyle || "classic") as CaptionStyleId,
            autoHook: Boolean(data.autoHook),
            splitScreen: Boolean(data.splitScreen),
            splitScreenBgId: data.splitScreenBgId ? String(data.splitScreenBgId) : undefined,
            isDemo: Boolean(data.isDemo),
            clips: Array.isArray(data.clips) ? (data.clips as ClipItem[]) : [],
          };
        });

        const pendingProjects = Array.from(pendingMap.values());
        const merged = pendingProjects.length > 0 ? [...pendingProjects, ...next] : next;
        if (merged.length === 0) return;

        setProjects(merged);
        setActiveProjectId((prevId) =>
          merged.some((p) => p.id === prevId) ? prevId : merged[0]?.id ?? ""
        );
      },
      (err) => handleFirestoreError(err, OperationType.LIST, projectsPath)
    );

    const templatesPath = `users/${uid}/brandTemplates`;
    const unsubTemplates = onSnapshot(
      query(collection(db, "users", uid, "brandTemplates"), orderBy("createdAt", "desc")),
      (snap) => {
        const next: BrandTemplate[] = snap.docs.map((d) => {
          const data = d.data();
          return {
            id: String(data.id || d.id),
            name: String(data.name || "Brand Template"),
            captionStyle: (data.captionStyle || "classic") as CaptionStyleId,
            aspectRatio: (data.aspectRatio || "9:16") as AspectRatio,
            autoHook: Boolean(data.autoHook),
            accentHex: String(data.accentHex || "#3B82F6"),
            watermarkHandle: String(data.watermarkHandle || "@creator"),
            splitScreen: Boolean(data.splitScreen),
          };
        });
        if (next.length > 0) setBrandTemplates(next);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, templatesPath)
    );

    const postsPath = `users/${uid}/scheduledPosts`;
    const unsubPosts = onSnapshot(
      query(collection(db, "users", uid, "scheduledPosts"), orderBy("createdAt", "desc")),
      (snap) => {
        const next: ScheduledPost[] = snap.docs.map((d) => {
          const data = d.data();
          return {
            id: String(data.id || d.id),
            clipId: String(data.clipId || ""),
            clipTitle: String(data.clipTitle || ""),
            projectTitle: String(data.projectTitle || ""),
            thumbnailUrl: String(data.thumbnailUrl || ""),
            platform: (data.platform || "TikTok") as ScheduledPost["platform"],
            scheduledFor: String(data.scheduledFor || ""),
            captionText: String(data.captionText || ""),
            status: (data.status || "Scheduled") as ScheduledPost["status"],
          };
        });
        setScheduledPosts(next);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, postsPath)
    );

    const usagePath = `users/${uid}/usageHistory`;
    const unsubUsage = onSnapshot(
      query(collection(db, "users", uid, "usageHistory"), orderBy("createdAt", "desc")),
      (snap) => {
        const next: UsageEntry[] = snap.docs.map((d) => {
          const data = d.data();
          return {
            id: String(data.id || d.id),
            projectTitle: String(data.projectTitle || ""),
            date: String(data.dateLabel || "Today"),
            minutesProcessed: Number(data.minutesProcessed) || 0,
            clipsGenerated: Number(data.clipsGenerated) || 0,
            sourceType: String(data.sourceType || "YouTube"),
          };
        });
        if (next.length > 0) setUsageHistory(next);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, usagePath)
    );

    return () => {
      unsubProjects();
      unsubTemplates();
      unsubPosts();
      unsubUsage();
    };
  }, [authReady, authUser]);

  const refreshSocialAccounts = useCallback(async () => {
    try {
      const res = await fetch("/api/social/accounts", { credentials: "same-origin" });
      if (!res.ok) return;
      const data = (await res.json()) as { accounts?: SocialAccountStatus[] };
      if (Array.isArray(data.accounts)) {
        setSocialAccounts(data.accounts);
      }
    } catch {
      // Ignore transient network failures on poll
    }
  }, []);

  useEffect(() => {
    refreshSocialAccounts();
  }, [refreshSocialAccounts]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const origin = event.origin || "";
      const isTrusted =
        origin === window.location.origin ||
        origin.endsWith(".run.app") ||
        origin.includes("localhost");
      if (!isTrusted) return;

      if (event.data?.type === "OAUTH_AUTH_SUCCESS") {
        setOauthError(null);
        setSetupGuideAccount(null);
        setConnectingPlatform(null);
        refreshSocialAccounts();
      } else if (event.data?.type === "OAUTH_AUTH_ERROR") {
        setConnectingPlatform(null);
        setOauthError(String(event.data?.error || "Social account connection failed."));
      }
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [refreshSocialAccounts]);

  // Sync persistent workspace state (excluding ephemeral blob URLs)
  useEffect(() => {
    try {
      const serializableProjects = projects.map((p) => ({
        ...p,
        localVideoUrl: undefined,
      }));
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          projects: serializableProjects,
          brandTemplates,
          scheduledPosts,
          usageHistory,
          autoUploadEnabled,
          autoQueueTopClip,
        })
      );
    } catch {
      // Ignore storage quota issues
    }
  }, [
    projects,
    brandTemplates,
    scheduledPosts,
    usageHistory,
    autoUploadEnabled,
    autoQueueTopClip,
  ]);

  const activeProject = useMemo(
    () => projects.find((p) => p.id === activeProjectId) || projects[0],
    [projects, activeProjectId]
  );

  const totalClipsCount = useMemo(
    () => projects.reduce((acc, p) => acc + p.clips.length, 0),
    [projects]
  );

  const favoritesCount = useMemo(
    () => projects.reduce((acc, p) => acc + p.clips.filter((c) => c.isFavorite).length, 0),
    [projects]
  );

  const inspectUrlSource = async (url: string): Promise<DraftVideoSource> => {
    const res = await fetchWithTimeout(
      "/api/video/inspect",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      },
      20000,
      "Video link inspection timed out. Please check the URL and try again."
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Failed to inspect URL");

    return {
      sourceType: data.platform || "youtube",
      url: data.url,
      youtubeId: data.youtubeId || undefined,
      thumbnailUrl:
        data.thumbnailUrl || "/src/assets/images/demo_travel_vlog_1795261138763.jpg",
      title: data.title || "Imported Video",
      channel: data.channel || "Creator",
      durationSec: data.durationSec || 1260,
      language: data.language || "English",
      topicSummary: data.topicSummary || "",
    };
  };

  // Inspect pasted video URL and open Configure screen
  const handleInspectUrl = async (url: string) => {
    setIsInspecting(true);
    setInspectError(null);
    setGenerateError(null);
    try {
      const source = await inspectUrlSource(url);
      setDraftSource(source);
      setRoute("configure");
    } catch (err) {
      setInspectError(err instanceof Error ? err.message : "Could not inspect video link");
    } finally {
      setIsInspecting(false);
    }
  };

  // One-step instant clip generation straight from URL paste / submit -> ProcessingView (with Flappy Bird) -> ClipsView
  const handleQuickGenerateFromUrl = async (url: string) => {
    const quickToken = ++activeGenTokenRef.current;
    setInspectError(null);
    setGenerateError(null);
    setQuickGeneratingLabel("Starting...");
    setProcessingMeta({
      title: "Fetching video from link...",
      thumbnailUrl: "/src/assets/images/demo_travel_vlog_1795261138763.jpg",
      sourceType: "youtube",
      aspectRatio: "9:16",
      clipType: "Viral Clips",
    });
    setProcessingStep(1);
    setProcessingPct(13);
    setRoute("processing");

    try {
      const source = await inspectUrlSource(url);
      if (activeGenTokenRef.current !== quickToken) return;
      setDraftSource(source);
      setProcessingMeta({
        title: source.title,
        thumbnailUrl: source.thumbnailUrl,
        sourceType: source.sourceType,
        aspectRatio: "9:16",
        clipType: "Viral Clips",
      });
      setProcessingStep(2);
      setProcessingPct(32);

      await generateClipsForSource(
        source,
        {
          title: source.title,
          clipType: "Viral Clips",
          customPrompt: "",
          targetDurationSec: 45,
          clipCount: 5,
          captionStyle: "classic",
          autoHook: true,
          language: source.language || "English",
          timeframeStartSec: 0,
          timeframeEndSec: source.durationSec,
          aspectRatio: "9:16",
          splitScreen: false,
          splitScreenBgId: "bg-subway-1",
          userNotes: "",
        },
        quickToken
      );
    } catch (err) {
      if (activeGenTokenRef.current !== quickToken) return;
      const msg = err instanceof Error ? err.message : "Could not generate clips from URL";
      setInspectError(msg);
      setGenerateError(msg);
    } finally {
      if (activeGenTokenRef.current === quickToken) {
        setQuickGeneratingLabel(null);
      }
    }
  };

  // Inspect local uploaded video/audio file and open Configure screen
  const handleUploadFile = async (file: File) => {
    setIsInspecting(true);
    setInspectError(null);
    setGenerateError(null);
    try {
      const objectUrl = URL.createObjectURL(file);
      const { durationSec, thumbnailUrl } = await inspectLocalMedia(file, objectUrl);

      // Attach inline base64 only for Gemini-supported media <= 10 MB so large files never stall upload
      let mediaBase64: string | undefined;
      let mediaMimeType: string | undefined;
      const safeMime = inferGeminiMimeType(file);
      if (safeMime && file.size <= 10 * 1024 * 1024) {
        try {
          mediaBase64 = await readFileAsBase64(file);
          mediaMimeType = safeMime;
        } catch {
          mediaBase64 = undefined;
          mediaMimeType = undefined;
        }
      }

      setDraftSource({
        sourceType: "upload",
        localVideoUrl: objectUrl,
        thumbnailUrl,
        title: file.name.replace(/\.\w+$/, "").replace(/[-_]+/g, " "),
        channel: "Local Upload",
        durationSec,
        mediaBase64,
        mediaMimeType,
      });
      setRoute("configure");
    } catch (err) {
      setInspectError(err instanceof Error ? err.message : "Could not load file");
    } finally {
      setIsInspecting(false);
    }
  };

  // Generate AI clips via server-side Gemini with live 4-step progress
  const generateClipsForSource = async (
    source: DraftVideoSource,
    config: ConfigureSubmitPayload,
    existingToken?: number
  ) => {
    const genToken =
      typeof existingToken === "number" ? existingToken : ++activeGenTokenRef.current;
    setIsGenerating(true);
    setGenerateError(null);
    setProcessingMeta({
      title: config.title,
      thumbnailUrl: source.thumbnailUrl,
      sourceType: source.sourceType,
      aspectRatio: config.aspectRatio,
      clipType: config.clipType,
    });
    setProcessingStep(2);
    setProcessingPct(35);
    setRoute("processing");

    const stepTimer = window.setInterval(() => {
      setProcessingPct((prev) => {
        if (prev < 58) {
          setProcessingStep(3);
          return prev + 4;
        }
        if (prev < 90) {
          setProcessingStep(4);
          return prev + 2;
        }
        return prev;
      });
    }, 550);

    try {
      const res = await fetchWithTimeout(
        "/api/clips/generate",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: config.title,
            channel: source.channel,
            url: source.url,
            durationSec: source.durationSec,
            language: config.language,
            clipType: config.clipType,
            customPrompt: config.customPrompt,
            targetDurationSec: config.targetDurationSec,
            clipCount: config.clipCount,
            autoHook: config.autoHook,
            timeframeStartSec: config.timeframeStartSec,
            timeframeEndSec: config.timeframeEndSec,
            userNotes: config.userNotes,
            topicSummary: source.topicSummary,
            mediaBase64: source.mediaBase64,
            mediaMimeType: source.mediaMimeType,
          }),
        },
        90000,
        "Clip generation timed out. For large videos, try trimming the timeframe or selecting fewer clips."
      );

      const data = await res.json().catch(() => ({}));
      if (activeGenTokenRef.current !== genToken) {
        return;
      }
      if (!res.ok) throw new Error(data.error || "Clip generation failed");

      window.clearInterval(stepTimer);
      setProcessingStep(4);
      setProcessingPct(100);

      const projectId = `proj-${Date.now()}`;
      const safeDuration = Math.max(15, Number(source.durationSec) || 300);
      const generatedClips: ClipItem[] = (data.clips || []).map(
        (
          raw: {
            rank: number;
            title: string;
            hookTitle: string;
            startTimeSec: number;
            endTimeSec: number;
            viralityScore: number;
            hookStrength: number;
            pacingScore: number;
            whyViral: string;
            videoCategory?: string;
            hashtags?: string[];
            transcript: Array<{
              startOffsetSec: number;
              endOffsetSec: number;
              text: string;
              emphasisWords: string[];
            }>;
          },
          idx: number
        ) => {
          const start = Math.max(
            0,
            Math.min(safeDuration - 5, Number(raw.startTimeSec) || 0)
          );
          const rawEnd = Number(raw.endTimeSec) || start + Math.min(45, safeDuration);
          const end = Math.min(safeDuration, Math.max(start + 5, rawEnd));
          const cleanedTags = Array.isArray(raw.hashtags)
            ? raw.hashtags.map(normalizeHashtag).filter(Boolean)
            : undefined;
          return {
            id: `${projectId}-clip-${idx + 1}`,
            projectId,
            rank: raw.rank || idx + 1,
            title: raw.title || `Viral Moment #${idx + 1}`,
            hookTitle: raw.hookTitle || raw.title || "WATCH THIS",
            startTimeSec: start,
            endTimeSec: end,
            durationSec: end - start,
            viralityScore: Math.min(99, Math.max(60, Number(raw.viralityScore) || 85)),
            hookStrength: Math.min(99, Math.max(60, Number(raw.hookStrength) || 86)),
            pacingScore: Math.min(99, Math.max(60, Number(raw.pacingScore) || 84)),
            whyViral: raw.whyViral || "Strong opening hook and concise pacing.",
            resolution: "1080p",
            aspectRatio: config.aspectRatio,
            captionStyle: config.captionStyle,
            showAutoHook: config.autoHook,
            focalPointX: 50,
            zoomScale: 1.1,
            splitScreen: config.splitScreen,
            splitScreenBgId: config.splitScreenBgId,
            language: config.language,
            isFavorite: false,
            videoCategory: raw.videoCategory || config.clipType,
            hashtags: cleanedTags,
            transcript: (raw.transcript || []).map((cue, cIdx) => ({
              id: `${projectId}-c-${idx}-${cIdx}`,
              startOffsetSec: Number(cue.startOffsetSec) || 0,
              endOffsetSec: Number(cue.endOffsetSec) || 5,
              text: cue.text || "",
              emphasisWords: Array.isArray(cue.emphasisWords) ? cue.emphasisWords : [],
            })),
          };
        }
      );

      const newProject: VideoProject = {
        id: projectId,
        title: config.title,
        channel: source.channel,
        sourceType: source.sourceType,
        url: source.url,
        youtubeId: source.youtubeId,
        localVideoUrl: source.localVideoUrl,
        thumbnailUrl: source.thumbnailUrl,
        durationSec: source.durationSec,
        createdAt: "Today",
        clipType: config.clipType,
        language: config.language,
        aspectRatio: config.aspectRatio,
        captionStyle: config.captionStyle,
        autoHook: config.autoHook,
        splitScreen: config.splitScreen,
        splitScreenBgId: config.splitScreenBgId,
        clips: generatedClips,
      };

      const minsProcessed = Math.max(
        1,
        Math.round((config.timeframeEndSec - config.timeframeStartSec) / 60)
      );

      if (newProject.localVideoUrl) {
        localVideoUrlMapRef.current[newProject.id] = newProject.localVideoUrl;
      }
      if (newProject.thumbnailUrl.startsWith("data:")) {
        localThumbnailMapRef.current[newProject.id] = newProject.thumbnailUrl;
      }

      const usageEntry: UsageEntry = {
        id: `u-${Date.now()}`,
        projectTitle: config.title,
        date: "Today",
        minutesProcessed: minsProcessed,
        clipsGenerated: generatedClips.length,
        sourceType: source.sourceType === "upload" ? "Upload" : "YouTube",
      };

      if (authUser && authUser.emailVerified) {
        pendingCloudProjectsRef.current.set(newProject.id, newProject);
      }

      setProjects((prev) => [newProject, ...prev]);
      setUsageHistory((prev) => [usageEntry, ...prev]);

      // Automatically queue #1 top viral clip to all connected social accounts when enabled
      const connectedChannels = socialAccounts.filter((a) => a.connected);
      let autoPosts: ScheduledPost[] = [];
      if (autoQueueTopClip && generatedClips[0] && connectedChannels.length > 0) {
        const topClip = generatedClips[0];
        const dueNow = formatNowLocal();
        autoPosts = connectedChannels.map((acct, i) => ({
          id: `post-${Date.now()}-${i}`,
          clipId: topClip.id,
          clipTitle: topClip.title,
          projectTitle: newProject.title,
          thumbnailUrl: newProject.thumbnailUrl,
          platform: acct.displayName,
          scheduledFor: dueNow,
          captionText: buildSocialCaptionWithTags(topClip, newProject, acct.displayName),
          status: "Scheduled",
        }));
        setScheduledPosts((prev) => [...autoPosts, ...prev]);
      }

      if (authUser && authUser.emailVerified) {
        saveProjectToCloud(authUser.uid, newProject, true).catch(console.error);
        saveUsageEntryToCloud(authUser.uid, usageEntry).catch(console.error);
        autoPosts.forEach((ap) =>
          saveScheduledPostToCloud(authUser.uid, ap, true).catch(console.error)
        );
      }

      setActiveProjectId(projectId);
      setTimeout(() => {
        if (activeGenTokenRef.current === genToken) {
          setRoute("clips");
        }
      }, 350);
    } catch (err) {
      if (activeGenTokenRef.current !== genToken) return;
      const msg = err instanceof Error ? err.message : "Failed to generate AI clips";
      setGenerateError(msg);
      throw err;
    } finally {
      window.clearInterval(stepTimer);
      if (activeGenTokenRef.current === genToken) {
        setIsGenerating(false);
      }
    }
  };

  const handleConnectPlatform = async (platform: SocialPlatformKey) => {
    setOauthError(null);
    setConnectingPlatform(platform);
    try {
      const res = await fetch(`/api/social/auth/${platform}`, {
        credentials: "same-origin",
      });
      const data = (await res.json()) as {
        configured?: boolean;
        url?: string;
        platform?: SocialPlatformKey;
        displayName?: SocialAccountStatus["displayName"];
        callbackUrl?: string;
        requiredEnvVars?: [string, string];
        developerConsoleUrl?: string;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error || "Could not start OAuth connection.");
      }

      if (!data.configured) {
        const existing = socialAccounts.find((a) => a.platform === platform);
        setSetupGuideAccount({
          platform,
          displayName: data.displayName || existing?.displayName || "TikTok",
          connected: false,
          configured: false,
          callbackUrl: data.callbackUrl || existing?.callbackUrl || "",
          requiredEnvVars: data.requiredEnvVars || existing?.requiredEnvVars || ["", ""],
          developerConsoleUrl:
            data.developerConsoleUrl || existing?.developerConsoleUrl || "",
        });
        setConnectingPlatform(null);
        return;
      }

      if (data.url) {
        const popup = window.open(data.url, "oauth_popup", "width=600,height=700");
        if (!popup) {
          setOauthError(
            "Popup blocked by browser. Please allow popups for this site and click Connect again."
          );
          setConnectingPlatform(null);
        }
      }
    } catch (err) {
      setOauthError(err instanceof Error ? err.message : "OAuth setup error");
      setConnectingPlatform(null);
    }
  };

  const handleDisconnectPlatform = async (platform: SocialPlatformKey) => {
    setOauthError(null);
    setConnectingPlatform(platform);
    try {
      const res = await fetch(`/api/social/disconnect/${platform}`, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "X-Requested-With": "ScaleReach",
        },
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to disconnect account.");
      }
      await refreshSocialAccounts();
    } catch (err) {
      setOauthError(err instanceof Error ? err.message : "Could not disconnect account.");
    } finally {
      setConnectingPlatform(null);
    }
  };

  const publishPostToChannel = useCallback(
    async (post: ScheduledPost, insertIfMissing = false) => {
      if (publishingLockRef.current) return;
      publishingLockRef.current = true;
      setPublishingPostId(post.id);
      setPublishError(null);

      try {
        let matchedClip: ClipItem | undefined;
        let matchedProject: VideoProject | undefined;
        for (const p of projects) {
          const found = p.clips.find((c) => c.id === post.clipId);
          if (found) {
            matchedClip = found;
            matchedProject = p;
            break;
          }
        }

        if (!matchedClip || !matchedProject) {
          throw new Error(`Source clip "${post.clipTitle}" was not found in your library.`);
        }

        setPublishStatusText(`Rendering "${matchedClip.title}" for ${post.platform}...`);
        const blob = await renderWebmClipBlob(
          matchedClip,
          matchedProject,
          (pct) =>
            setPublishStatusText(
              `Rendering "${matchedClip!.title}" for ${post.platform} (${pct}%)...`
            ),
          8
        );

        setPublishStatusText(`Uploading "${matchedClip.title}" to ${post.platform}...`);
        const videoBase64 = await blobToBase64(blob);

        const res = await fetch("/api/social/publish", {
          method: "POST",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
            "X-Requested-With": "ScaleReach",
          },
          body: JSON.stringify({
            platform: post.platform,
            title: matchedClip.title,
            captionText: post.captionText,
            videoBase64,
            mimeType: "video/webm",
          }),
        });

        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(data.error || `Failed to publish to ${post.platform}`);
        }

        const publishedPost: ScheduledPost = {
          ...post,
          status: "Published",
          scheduledFor: "Published now",
        };
        const isNewPost =
          insertIfMissing && !scheduledPosts.some((p) => p.id === post.id);

        setScheduledPosts((prev) => {
          const exists = prev.some((p) => p.id === post.id);
          if (exists) {
            return prev.map((p) => (p.id === post.id ? publishedPost : p));
          }
          if (insertIfMissing) {
            return [publishedPost, ...prev];
          }
          return prev;
        });

        if (authUser && authUser.emailVerified) {
          saveScheduledPostToCloud(authUser.uid, publishedPost, isNewPost).catch(
            console.error
          );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Upload failed.";
        setPublishError(msg);
        throw err;
      } finally {
        publishingLockRef.current = false;
        setPublishingPostId(null);
        setPublishStatusText(null);
      }
    },
    [projects, scheduledPosts, authUser]
  );

  const handleRunDueUploads = useCallback(async () => {
    setPublishError(null);
    const scheduled = scheduledPosts.filter((p) => p.status === "Scheduled");
    if (scheduled.length === 0) return;

    const duePosts = scheduled.filter((p) => {
      const acct = socialAccounts.find((a) => a.displayName === p.platform);
      return Boolean(acct?.connected) && isPostDue(p.scheduledFor);
    });

    if (duePosts.length === 0) {
      const connectedScheduled = scheduled.filter((p) =>
        socialAccounts.some((a) => a.displayName === p.platform && a.connected)
      );
      if (connectedScheduled.length === 0) {
        setPublishError(
          "Connect the target social account above before uploading queued clips."
        );
      } else {
        setPublishError(
          "No queued posts have reached their scheduled upload time yet. Click Publish Now on any row to upload immediately."
        );
      }
      return;
    }

    for (const post of duePosts) {
      try {
        await publishPostToChannel(post, false);
      } catch {
        break;
      }
    }
  }, [scheduledPosts, socialAccounts, publishPostToChannel]);

  // Background auto-upload interval for scheduled clips once their publish time arrives
  useEffect(() => {
    if (!autoUploadEnabled) return;
    const timer = window.setInterval(() => {
      if (publishingLockRef.current) return;
      const nextDue = scheduledPosts.find((p) => {
        if (p.status !== "Scheduled") return false;
        const acct = socialAccounts.find((a) => a.displayName === p.platform);
        return Boolean(acct?.connected) && isPostDue(p.scheduledFor);
      });
      if (nextDue) {
        publishPostToChannel(nextDue, false).catch(() => {});
      }
    }, 15000);
    return () => window.clearInterval(timer);
  }, [autoUploadEnabled, scheduledPosts, socialAccounts, publishPostToChannel]);

  const handleGenerateClips = async (config: ConfigureSubmitPayload) => {
    if (!draftSource) return;
    await generateClipsForSource(draftSource, config).catch(() => {});
  };

  const updateProject = (updated: VideoProject) => {
    if (pendingCloudProjectsRef.current.has(updated.id)) {
      pendingCloudProjectsRef.current.set(updated.id, updated);
    }
    setProjects((prev) => prev.map((p) => (p.id === updated.id ? updated : p)));
    if (authUser && authUser.emailVerified) {
      saveProjectToCloud(authUser.uid, updated, false).catch(console.error);
    }
  };

  const updateClipInProject = (updatedClip: ClipItem) => {
    const target = projects.find((p) => p.id === updatedClip.projectId);
    const nextProject = target
      ? {
          ...target,
          clips: target.clips.map((c) => (c.id === updatedClip.id ? updatedClip : c)),
        }
      : null;

    if (nextProject && pendingCloudProjectsRef.current.has(nextProject.id)) {
      pendingCloudProjectsRef.current.set(nextProject.id, nextProject);
    }

    setProjects((prev) =>
      prev.map((p) =>
        p.id === updatedClip.projectId
          ? {
              ...p,
              clips: p.clips.map((c) => (c.id === updatedClip.id ? updatedClip : c)),
            }
          : p
      )
    );
    if (nextProject && authUser && authUser.emailVerified) {
      saveProjectToCloud(authUser.uid, nextProject, false).catch(console.error);
    }
  };

  const deleteClipFromProject = (projectId: string, clipId: string) => {
    const target = projects.find((p) => p.id === projectId);
    const nextProject = target
      ? { ...target, clips: target.clips.filter((c) => c.id !== clipId) }
      : null;

    if (nextProject && pendingCloudProjectsRef.current.has(nextProject.id)) {
      pendingCloudProjectsRef.current.set(nextProject.id, nextProject);
    }

    setProjects((prev) =>
      prev.map((p) =>
        p.id === projectId
          ? { ...p, clips: p.clips.filter((c) => c.id !== clipId) }
          : p
      )
    );
    if (nextProject && authUser && authUser.emailVerified) {
      saveProjectToCloud(authUser.uid, nextProject, false).catch(console.error);
    }
  };

  const breadcrumbLabels: Record<AppRoute, string[]> = {
    home: ["Dashboard", "Videos"],
    configure: ["Dashboard", "Configure"],
    processing: ["Dashboard", "Videos", "Processing"],
    clips: ["Dashboard", "Videos", "Clips"],
    "all-clips": ["Library", "All Clips"],
    favorites: ["Library", "Favorites"],
    "brand-templates": ["Tools", "Brand Templates"],
    "social-scheduler": ["Tools", "Social Scheduler"],
    "ai-assistant": ["Tools", "AI Clip Assistant"],
  };

  const crumbs = breadcrumbLabels[route];

  return (
    <div className="h-screen w-screen overflow-hidden bg-[#0A0A0C] text-[#F4F4F6] flex">
      <Sidebar
        activeRoute={route}
        onNavigate={(r) => {
          if (r === "social-scheduler") setSchedulerTab("accounts");
          setRoute(r);
        }}
        totalClipsCount={totalClipsCount}
        favoritesCount={favoritesCount}
        mobileOpen={mobileMenuOpen}
        onCloseMobile={() => setMobileMenuOpen(false)}
        authUser={authUser}
        authLoading={authLoading}
        isAdmin={isAdmin}
        onSignInGoogle={handleSignInGoogle}
        onSignOut={handleSignOut}
      />

      <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
        {/* Top Contextual Breadcrumb Bar */}
        <header className="h-13 px-5 border-b border-[#202028] bg-[#0C0C0F] flex items-center justify-between gap-4 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className="lg:hidden p-1.5 rounded-lg bg-[#16161B] border border-[#262630] text-zinc-300"
              aria-label="Open navigation menu"
            >
              <PanelLeft className="w-4 h-4" />
            </button>

            <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-xs">
              {crumbs.map((label, idx) => {
                const isLast = idx === crumbs.length - 1;
                return (
                  <React.Fragment key={label}>
                    {idx > 0 && <ChevronRight className="w-3.5 h-3.5 text-zinc-600" />}
                    <button
                      type="button"
                      onClick={() => {
                        if (idx === 0 || label === "Videos") setRoute("home");
                      }}
                      className={`whitespace-nowrap ${
                        isLast
                          ? "text-zinc-100 font-semibold"
                          : "text-zinc-500 hover:text-zinc-300"
                      }`}
                    >
                      {label}
                    </button>
                  </React.Fragment>
                );
              })}
            </nav>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            {authUser ? (
              <span className="hidden sm:inline-flex items-center gap-1.5 text-xs text-emerald-400 font-medium">
                <Cloud className="w-3.5 h-3.5" />
                {authUser.displayName || authUser.email}
              </span>
            ) : (
              <button
                type="button"
                disabled={authLoading}
                onClick={handleSignInGoogle}
                className="px-3 py-1 rounded-md bg-white hover:bg-zinc-100 text-zinc-900 text-xs font-semibold transition-colors"
              >
                {authLoading ? "Connecting..." : "Sign in"}
              </button>
            )}
            <span className="text-xs font-medium text-zinc-400 whitespace-nowrap">
              AI Video Clip Generator · <span className="text-zinc-500">Dev: HBM</span>
            </span>
          </div>
        </header>

        {/* Scrollable Workspace Viewport */}
        <main className="flex-1 overflow-y-auto">
          {authError && (
            <div className="mx-6 mt-4 rounded-xl bg-red-950/40 border border-red-900/60 px-4 py-2.5 flex items-center justify-between gap-3 text-xs text-red-200">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
                <span>{authError}</span>
              </div>
              <button
                type="button"
                onClick={() => setAuthError(null)}
                aria-label="Dismiss auth error"
                className="text-red-300 hover:text-white"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
          {route === "home" && (
            <HomeView
              projects={projects}
              greetingName={authUser?.displayName?.split(" ")[0]}
              onQuickGenerateFromUrl={handleQuickGenerateFromUrl}
              onInspectUrl={handleInspectUrl}
              onUploadFile={handleUploadFile}
              onOpenProject={(id) => {
                setActiveProjectId(id);
                setRoute("clips");
              }}
              isInspecting={isInspecting}
              quickGeneratingLabel={quickGeneratingLabel}
              inspectError={inspectError}
            />
          )}

          {route === "configure" && draftSource && (
            <ConfigureView
              key={draftSource.url || draftSource.localVideoUrl || draftSource.title}
              source={draftSource}
              brandTemplates={brandTemplates}
              onBack={() => setRoute("home")}
              onGenerate={handleGenerateClips}
              isGenerating={isGenerating}
              generateError={generateError}
            />
          )}

          {route === "processing" && processingMeta && (
            <ProcessingView
              meta={processingMeta}
              currentStep={processingStep}
              progressPct={processingPct}
              error={generateError}
              onCancel={() => {
                activeGenTokenRef.current += 1;
                setIsGenerating(false);
                setQuickGeneratingLabel(null);
                setGenerateError(null);
                setRoute("home");
              }}
            />
          )}

          {route === "clips" && activeProject && (
            <ClipsView
              project={activeProject}
              onBack={() => setRoute("home")}
              onUpdateProject={updateProject}
              onUpdateClip={updateClipInProject}
              onDeleteClip={(clipId) => deleteClipFromProject(activeProject.id, clipId)}
              onOpenEditor={(clip) => setEditingClip({ clip, project: activeProject })}
              onOpenPostModal={(clip, platform) =>
                setPostingClip({ clip, project: activeProject, platform })
              }
            />
          )}

          {(route === "all-clips" || route === "favorites") && (
            <LibraryClipsView
              mode={route === "favorites" ? "favorites" : "all"}
              projects={projects}
              onOpenProject={(id) => {
                setActiveProjectId(id);
                setRoute("clips");
              }}
              onUpdateClip={updateClipInProject}
              onOpenEditor={(clip, project) => setEditingClip({ clip, project })}
              onOpenPost={(clip, project) => setPostingClip({ clip, project })}
            />
          )}

          {route === "brand-templates" && (
            <BrandTemplatesView
              templates={brandTemplates}
              onAddTemplate={(tpl) => {
                setBrandTemplates((prev) => [tpl, ...prev]);
                if (authUser && authUser.emailVerified) {
                  saveBrandTemplateToCloud(authUser.uid, tpl, true).catch(console.error);
                }
              }}
              onDeleteTemplate={(id) => {
                setBrandTemplates((prev) => prev.filter((t) => t.id !== id));
                if (authUser && authUser.emailVerified) {
                  deleteBrandTemplateFromCloud(authUser.uid, id).catch(console.error);
                }
              }}
            />
          )}

          {route === "social-scheduler" && (
            <SocialSchedulerView
              accounts={socialAccounts}
              posts={scheduledPosts}
              connectingPlatform={connectingPlatform}
              publishingPostId={publishingPostId}
              publishStatusText={publishStatusText}
              publishError={publishError}
              oauthError={oauthError}
              setupGuideAccount={setupGuideAccount}
              autoUploadEnabled={autoUploadEnabled}
              autoQueueTopClip={autoQueueTopClip}
              isAdmin={isAdmin}
              isSignedIn={Boolean(authUser)}
              initialTab={schedulerTab}
              onSignInGoogle={handleSignInGoogle}
              onConnectPlatform={handleConnectPlatform}
              onDisconnectPlatform={handleDisconnectPlatform}
              onToggleAutoUpload={() => {
                const next = !autoUploadEnabled;
                setAutoUploadEnabled(next);
                if (authUser && authUser.emailVerified) {
                  updateUserPreferencesInCloud(authUser.uid, {
                    autoUploadEnabled: next,
                    autoQueueTopClip,
                  }).catch(console.error);
                }
              }}
              onToggleAutoQueueTopClip={() => {
                const next = !autoQueueTopClip;
                setAutoQueueTopClip(next);
                if (authUser && authUser.emailVerified) {
                  updateUserPreferencesInCloud(authUser.uid, {
                    autoUploadEnabled,
                    autoQueueTopClip: next,
                  }).catch(console.error);
                }
              }}
              onRunDueUploads={handleRunDueUploads}
              onPublishNow={(postId) => {
                const post = scheduledPosts.find((p) => p.id === postId);
                if (post) {
                  publishPostToChannel(post, false).catch(() => {});
                }
              }}
              onDeletePost={(postId) => {
                setScheduledPosts((prev) => prev.filter((p) => p.id !== postId));
                if (authUser && authUser.emailVerified) {
                  deleteScheduledPostFromCloud(authUser.uid, postId).catch(console.error);
                }
              }}
              onCloseSetupGuide={() => setSetupGuideAccount(null)}
              onRefreshAccounts={refreshSocialAccounts}
            />
          )}

          {route === "ai-assistant" && activeProject && (
            <AiAssistantView
              projects={projects}
              activeProject={activeProject}
              onSelectProject={(id) => setActiveProjectId(id)}
              onApplyStyle={(projectId, style: CaptionStyleId) => {
                const target = projects.find((p) => p.id === projectId);
                const updated = target
                  ? {
                      ...target,
                      captionStyle: style,
                      clips: target.clips.map((c) => ({ ...c, captionStyle: style })),
                    }
                  : null;
                setProjects((prev) =>
                  prev.map((p) =>
                    p.id === projectId
                      ? {
                          ...p,
                          captionStyle: style,
                          clips: p.clips.map((c) => ({ ...c, captionStyle: style })),
                        }
                      : p
                  )
                );
                if (updated && authUser && authUser.emailVerified) {
                  saveProjectToCloud(authUser.uid, updated, false).catch(console.error);
                }
              }}
              onApplyAspect={(projectId, ratio: AspectRatio) => {
                const target = projects.find((p) => p.id === projectId);
                const updated = target
                  ? {
                      ...target,
                      aspectRatio: ratio,
                      clips: target.clips.map((c) => ({ ...c, aspectRatio: ratio })),
                    }
                  : null;
                setProjects((prev) =>
                  prev.map((p) =>
                    p.id === projectId
                      ? {
                          ...p,
                          aspectRatio: ratio,
                          clips: p.clips.map((c) => ({ ...c, aspectRatio: ratio })),
                        }
                      : p
                  )
                );
                if (updated && authUser && authUser.emailVerified) {
                  saveProjectToCloud(authUser.uid, updated, false).catch(console.error);
                }
              }}
              onOpenProjectClips={(projectId) => {
                setActiveProjectId(projectId);
                setRoute("clips");
              }}
            />
          )}
        </main>
      </div>

      {/* Browser Clip Editor Modal */}
      {editingClip && (
        <ClipEditorModal
          clip={editingClip.clip}
          project={editingClip.project}
          onSave={(updated) => updateClipInProject(updated)}
          onClose={() => setEditingClip(null)}
        />
      )}

      {/* Social Post Modal */}
      {postingClip && (
        <PostModal
          clip={postingClip.clip}
          project={postingClip.project}
          accounts={socialAccounts}
          initialPlatform={postingClip.platform}
          onSchedule={(post) => {
            setScheduledPosts((prev) => [post, ...prev]);
            if (authUser && authUser.emailVerified) {
              saveScheduledPostToCloud(authUser.uid, post, true).catch(console.error);
            }
            setSchedulerTab("posts");
            setRoute("social-scheduler");
          }}
          onPublishNow={async (post) => {
            await publishPostToChannel(post, true);
            setSchedulerTab("posts");
            setRoute("social-scheduler");
          }}
          onConnectPlatform={(platformName) => {
            const acct = socialAccounts.find((a) => a.displayName === platformName);
            setSchedulerTab("accounts");
            setRoute("social-scheduler");
            if (acct) {
              handleConnectPlatform(acct.platform);
            }
          }}
          onUpdateClip={updateClipInProject}
          onClose={() => setPostingClip(null)}
        />
      )}
    </div>
  );
}
