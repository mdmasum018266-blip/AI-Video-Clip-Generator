import React, { useEffect, useId, useMemo, useRef, useState } from "react";
import {
  Pause,
  Play,
  Volume2,
  VolumeX,
  Film,
  Maximize2,
  Minimize2,
  Loader2,
  RotateCcw,
  AlertCircle,
} from "lucide-react";
import { ClipItem, VideoProject } from "../types";
import { ASSET_IMAGES, normalizeAssetUrl } from "../data/assetImages";
import { BACKGROUND_VIDEOS } from "../data/presets";
import { CaptionPreview } from "./CaptionPreview";
import { formatTime } from "../utils/exportClip";

interface YTPlayerInstance {
  playVideo: () => void;
  pauseVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  getCurrentTime: () => number;
  mute: () => void;
  unMute: () => void;
  setVolume?: (volume: number) => void;
  setPlaybackRate?: (suggestedRate: number) => void;
  destroy: () => void;
}

declare global {
  interface Window {
    YT?: {
      Player: new (
        elementId: string,
        options: {
          videoId: string;
          playerVars?: Record<string, string | number>;
          events?: {
            onReady?: (e: { target: YTPlayerInstance }) => void;
            onStateChange?: (e: { data: number }) => void;
            onError?: () => void;
          };
        }
      ) => YTPlayerInstance;
      PlayerState?: {
        PLAYING: number;
        PAUSED: number;
        ENDED: number;
      };
    };
    onYouTubeIframeAPIReady?: () => void;
  }
}

let ytApiPromise: Promise<void> | null = null;
function loadYouTubeIframeApi(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.YT && window.YT.Player) return Promise.resolve();
  if (ytApiPromise) return ytApiPromise;

  ytApiPromise = new Promise<void>((resolve) => {
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      if (prev) prev();
      resolve();
    };
    if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
      const tag = document.createElement("script");
      tag.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(tag);
    }
  });
  return ytApiPromise;
}

const SPEED_OPTIONS = [0.75, 1, 1.25, 1.5, 2] as const;

interface ClipPlayerProps {
  clip: ClipItem;
  project: VideoProject;
  externalSeek?: { sec: number; seq: number } | null;
  externalSeekSec?: number | null;
  onTimeUpdate?: (sec: number) => void;
  size?: "card" | "editor";
}

export const ClipPlayer: React.FC<ClipPlayerProps> = ({
  clip,
  project,
  externalSeek,
  externalSeekSec,
  onTimeUpdate,
  size = "card",
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [audioOn, setAudioOn] = useState(true);
  const [volume, setVolume] = useState(0.9);
  const [playbackRate, setPlaybackRate] = useState<number>(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);
  const [localVideoFailed, setLocalVideoFailed] = useState(false);
  const [localVideoLoading, setLocalVideoLoading] = useState(false);
  const [ytActivated, setYtActivated] = useState(false);
  const [ytReady, setYtReady] = useState(false);
  const [ytPlaying, setYtPlaying] = useState(false);
  const [ytError, setYtError] = useState(false);
  const [retrySeq, setRetrySeq] = useState(0);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const ytPlayerRef = useRef<YTPlayerInstance | null>(null);
  const lastSpokenCueId = useRef<string | null>(null);
  const onTimeUpdateRef = useRef(onTimeUpdate);
  onTimeUpdateRef.current = onTimeUpdate;
  const audioOnRef = useRef(audioOn);
  audioOnRef.current = audioOn;
  const volumeRef = useRef(volume);
  volumeRef.current = volume;
  const playbackRateRef = useRef(playbackRate);
  playbackRateRef.current = playbackRate;
  const currentTimeRef = useRef(currentTime);
  currentTimeRef.current = currentTime;
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;
  const startTimeRef = useRef(clip.startTimeSec);
  startTimeRef.current = clip.startTimeSec;
  const ytDomId = useId().replace(/:/g, "");

  useEffect(() => {
    setIsPlaying(false);
    setCurrentTime(0);
    setImgFailed(false);
    setLocalVideoFailed(false);
    setLocalVideoLoading(Boolean(project.localVideoUrl));
    setYtActivated(false);
    setYtReady(false);
    setYtPlaying(false);
    setYtError(false);
    lastSpokenCueId.current = null;
  }, [clip.id, project.localVideoUrl, project.youtubeId]);

  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement && document.fullscreenElement === containerRef.current));
    };
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  const effectiveDuration = useMemo(() => {
    const lastCueEnd = clip.transcript[clip.transcript.length - 1]?.endOffsetSec ?? 0;
    return Math.max(clip.durationSec, lastCueEnd, 15);
  }, [clip.durationSec, clip.transcript]);

  const useLocalVideo = Boolean(project.localVideoUrl) && !localVideoFailed;
  const useYouTubeEmbed = Boolean(project.youtubeId) && !useLocalVideo && !ytError;
  const hasVideoSourceError =
    (Boolean(project.localVideoUrl) && localVideoFailed) ||
    (Boolean(project.youtubeId) && !project.localVideoUrl && ytError);
  const isBuffering =
    (useLocalVideo && localVideoLoading) ||
    (useYouTubeEmbed && ytActivated && !ytReady && !ytError);

  // Lazy-initialize real YouTube IFrame Player only once user hits Play/seek
  useEffect(() => {
    if (!useYouTubeEmbed || !ytActivated || !project.youtubeId) return;
    let cancelled = false;
    let ready = false;
    let stallTimer = 0;

    loadYouTubeIframeApi().then(() => {
      if (cancelled || !window.YT?.Player) return;
      try {
        ytPlayerRef.current = new window.YT.Player(`yt-${ytDomId}`, {
          videoId: project.youtubeId!,
          playerVars: {
            autoplay: 1,
            controls: 0,
            disablekb: 1,
            fs: 0,
            modestbranding: 1,
            rel: 0,
            playsinline: 1,
            origin: typeof window !== "undefined" ? window.location.origin : "",
            start: Math.floor(startTimeRef.current),
          },
          events: {
            onReady: (e) => {
              if (cancelled) return;
              ready = true;
              window.clearTimeout(stallTimer);
              setYtReady(true);
              if (!audioOnRef.current || volumeRef.current <= 0) {
                e.target.mute();
              } else {
                e.target.unMute();
                e.target.setVolume?.(Math.round(volumeRef.current * 100));
              }
              e.target.setPlaybackRate?.(playbackRateRef.current);
              if (currentTimeRef.current > 0.2) {
                e.target.seekTo(startTimeRef.current + currentTimeRef.current, true);
              }
              if (isPlayingRef.current) {
                e.target.playVideo();
              } else {
                e.target.pauseVideo();
              }
            },
            onStateChange: (e) => {
              if (cancelled) return;
              if (e.data === 1) {
                ready = true;
                setYtPlaying(true);
                window.clearTimeout(stallTimer);
              } else if (e.data === 2 || e.data === 0) {
                setYtPlaying(false);
              }
            },
            onError: () => {
              window.clearTimeout(stallTimer);
              if (!cancelled) setYtError(true);
            },
          },
        });
        stallTimer = window.setTimeout(() => {
          if (!cancelled && !ready) {
            setYtError(true);
          }
        }, 7000);
      } catch {
        setYtError(true);
      }
    });

    return () => {
      cancelled = true;
      window.clearTimeout(stallTimer);
      if (ytPlayerRef.current) {
        try {
          ytPlayerRef.current.destroy();
        } catch {
          // Ignore
        }
        ytPlayerRef.current = null;
      }
      setYtReady(false);
      setYtPlaying(false);
    };
  }, [useYouTubeEmbed, ytActivated, project.youtubeId, ytDomId, retrySeq]);

  // Sync mute, volume, and playback speed on YouTube or local video
  useEffect(() => {
    const effectiveVol = audioOn ? volume : 0;
    if (ytPlayerRef.current && ytReady) {
      if (effectiveVol <= 0) {
        ytPlayerRef.current.mute();
      } else {
        ytPlayerRef.current.unMute();
        ytPlayerRef.current.setVolume?.(Math.round(effectiveVol * 100));
      }
      ytPlayerRef.current.setPlaybackRate?.(playbackRate);
    }
    if (videoRef.current) {
      videoRef.current.muted = !audioOn || volume <= 0;
      videoRef.current.volume = Math.min(1, Math.max(0, volume));
      videoRef.current.playbackRate = playbackRate;
    }
  }, [audioOn, volume, playbackRate, ytReady]);

  // External seek from clicking transcript cue
  const seekTarget = externalSeek ? externalSeek.sec : externalSeekSec;
  const seekSeq = externalSeek ? externalSeek.seq : externalSeekSec;
  useEffect(() => {
    if (typeof seekTarget === "number") {
      if (useYouTubeEmbed) setYtActivated(true);
      setCurrentTime(seekTarget);
      if (useLocalVideo && videoRef.current) {
        const vid = videoRef.current;
        const dur = Number.isFinite(vid.duration) && vid.duration > 0 ? vid.duration : 0;
        const safeStart = dur > 2 ? Math.min(clip.startTimeSec, Math.max(0, dur - 2)) : 0;
        const target = dur > 0 ? Math.min(dur - 0.1, safeStart + seekTarget) : safeStart + seekTarget;
        vid.currentTime = Math.max(0, target);
      }
      if (ytPlayerRef.current && ytReady) {
        ytPlayerRef.current.seekTo(clip.startTimeSec + seekTarget, true);
        ytPlayerRef.current.playVideo();
      }
      setIsPlaying(true);
    }
  }, [seekTarget, seekSeq, clip.startTimeSec, ytReady, useYouTubeEmbed, useLocalVideo]);

  // Playback loop (syncs real YouTube IFrame / local <video> / fallback studio timer)
  useEffect(() => {
    if (!isPlaying) {
      if (videoRef.current) videoRef.current.pause();
      if (ytPlayerRef.current && ytReady) {
        try {
          ytPlayerRef.current.pauseVideo();
        } catch {
          // Ignore
        }
      }
      return;
    }

    if (useLocalVideo && videoRef.current) {
      const vid = videoRef.current;
      const dur = Number.isFinite(vid.duration) && vid.duration > 0 ? vid.duration : 0;
      const safeStart = dur > 2 ? Math.min(clip.startTimeSec, Math.max(0, dur - 2)) : 0;
      const target = dur > 0 ? Math.min(dur - 0.1, safeStart + currentTime) : safeStart + currentTime;
      if (Math.abs(vid.currentTime - target) > 0.6) {
        vid.currentTime = target;
      }
      vid.playbackRate = playbackRate;
      vid.play().catch(() => {});
    }

    if (useYouTubeEmbed && ytPlayerRef.current && ytReady) {
      try {
        const ytTime = ytPlayerRef.current.getCurrentTime?.() ?? 0;
        if (
          ytTime < clip.startTimeSec ||
          ytTime > clip.startTimeSec + effectiveDuration
        ) {
          ytPlayerRef.current.seekTo(clip.startTimeSec + currentTime, true);
        }
        ytPlayerRef.current.setPlaybackRate?.(playbackRate);
        ytPlayerRef.current.playVideo();
      } catch {
        // Ignore
      }
    }

    const interval = window.setInterval(() => {
      if (useLocalVideo && videoRef.current && !videoRef.current.paused && !videoRef.current.ended) {
        const vid = videoRef.current;
        const dur = Number.isFinite(vid.duration) && vid.duration > 0 ? vid.duration : 0;
        const safeStart = dur > 2 ? Math.min(clip.startTimeSec, Math.max(0, dur - 2)) : 0;
        const rel = vid.currentTime - safeStart;
        if (rel >= effectiveDuration) {
          setIsPlaying(false);
          vid.pause();
          vid.currentTime = safeStart;
          setCurrentTime(0);
          return;
        }
        if (rel >= 0) {
          setCurrentTime(Number(rel.toFixed(1)));
          return;
        }
      }

      if (useYouTubeEmbed && ytPlayerRef.current && ytReady && ytPlaying) {
        try {
          const rawYt = ytPlayerRef.current.getCurrentTime();
          if (typeof rawYt === "number" && rawYt > 0) {
            const rel = rawYt - clip.startTimeSec;
            if (rel >= effectiveDuration) {
              setIsPlaying(false);
              ytPlayerRef.current.pauseVideo();
              ytPlayerRef.current.seekTo(clip.startTimeSec, true);
              setCurrentTime(0);
              return;
            }
            if (rel >= 0) {
              setCurrentTime(Number(rel.toFixed(1)));
              return;
            }
          }
        } catch {
          // Fall through to incremental timer
        }
      }

      setCurrentTime((prev) => {
        const next = prev + 0.1 * playbackRate;
        if (next >= effectiveDuration) {
          setIsPlaying(false);
          if (videoRef.current) videoRef.current.pause();
          return 0;
        }
        return Number(next.toFixed(1));
      });
    }, 100);

    return () => {
      window.clearInterval(interval);
    };
  }, [
    isPlaying,
    effectiveDuration,
    useLocalVideo,
    clip.startTimeSec,
    useYouTubeEmbed,
    ytReady,
    ytPlaying,
    playbackRate,
  ]);

  useEffect(() => {
    if (onTimeUpdateRef.current) onTimeUpdateRef.current(currentTime);
  }, [currentTime]);

  const activeCue = useMemo(() => {
    return (
      clip.transcript.find(
        (c) => currentTime >= c.startOffsetSec && currentTime <= c.endOffsetSec
      ) || clip.transcript[0]
    );
  }, [clip.transcript, currentTime]);

  // Web Speech API fallback only when neither local video nor active YouTube embed is used
  useEffect(() => {
    if (!audioOn || volume <= 0 || !isPlaying || useLocalVideo || (useYouTubeEmbed && !ytError)) {
      if (typeof window !== "undefined" && "speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
      return;
    }
    if (activeCue && lastSpokenCueId.current !== activeCue.id) {
      lastSpokenCueId.current = activeCue.id;
      if ("speechSynthesis" in window) {
        window.speechSynthesis.cancel();
        const utter = new SpeechSynthesisUtterance(activeCue.text);
        utter.rate = Math.min(2, Math.max(0.75, 1.05 * playbackRate));
        utter.volume = Math.min(1, Math.max(0, volume));
        window.speechSynthesis.speak(utter);
      }
    }
  }, [audioOn, volume, playbackRate, isPlaying, activeCue, useLocalVideo, useYouTubeEmbed, ytError]);

  useEffect(() => {
    return () => {
      if ("speechSynthesis" in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const activeWordIndex = useMemo(() => {
    if (!activeCue || !isPlaying) return -1;
    const words = activeCue.text.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return -1;
    const cueSpan = Math.max(0.5, activeCue.endOffsetSec - activeCue.startOffsetSec);
    const ratio = Math.min(0.99, Math.max(0, (currentTime - activeCue.startOffsetSec) / cueSpan));
    return Math.floor(ratio * words.length);
  }, [activeCue, currentTime, isPlaying]);

  const splitBg = useMemo(() => {
    return (
      BACKGROUND_VIDEOS.find((b) => b.id === clip.splitScreenBgId) || BACKGROUND_VIDEOS[0]
    );
  }, [clip.splitScreenBgId]);

  const safeThumbnailUrl = useMemo(
    () => normalizeAssetUrl(project.thumbnailUrl, ASSET_IMAGES.demoCreatorEditing),
    [project.thumbnailUrl]
  );
  const safeSplitBgThumb = useMemo(
    () => normalizeAssetUrl(splitBg.thumbnailUrl, ASSET_IMAGES.bgGameplayRunner),
    [splitBg.thumbnailUrl]
  );

  const aspectClass =
    clip.aspectRatio === "9:16"
      ? "aspect-[9/16]"
      : clip.aspectRatio === "1:1"
      ? "aspect-square"
      : "aspect-video";

  const widthClass = isFullscreen
    ? "w-full h-full max-w-none"
    : size === "editor"
    ? clip.aspectRatio === "9:16"
      ? "w-[260px] sm:w-[290px]"
      : clip.aspectRatio === "1:1"
      ? "w-[320px] sm:w-[360px]"
      : "w-full max-w-[480px]"
    : clip.aspectRatio === "9:16"
    ? "w-[230px] sm:w-[248px]"
    : clip.aspectRatio === "1:1"
    ? "w-[260px] sm:w-[280px]"
    : "w-full max-w-[360px]";

  // Compute cropped horizontal offset for 16:9 YouTube iframe inside 9:16 or 1:1 container
  const ytCropShift = ((50 - clip.focalPointX) * 0.45).toFixed(1);

  const handleRetrySource = (e: React.MouseEvent) => {
    e.stopPropagation();
    setLocalVideoFailed(false);
    setYtError(false);
    setYtReady(false);
    setYtPlaying(false);
    if (project.localVideoUrl) {
      setLocalVideoLoading(true);
    }
    if (project.youtubeId) {
      setYtActivated(true);
    }
    setRetrySeq((n) => n + 1);
  };

  const handleToggleFullscreen = (e: React.MouseEvent) => {
    e.stopPropagation();
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement === el) {
      document.exitFullscreen?.().catch(() => {});
    } else {
      el.requestFullscreen?.().catch(() => {});
    }
  };

  const handleCycleSpeed = (e: React.MouseEvent) => {
    e.stopPropagation();
    const idx = SPEED_OPTIONS.indexOf(playbackRate as (typeof SPEED_OPTIONS)[number]);
    const next = SPEED_OPTIONS[(idx + 1) % SPEED_OPTIONS.length];
    setPlaybackRate(next);
  };

  const renderPrimaryVideoLayer = () => {
    if (useLocalVideo && project.localVideoUrl) {
      return (
        <video
          key={`local-${retrySeq}`}
          ref={videoRef}
          src={project.localVideoUrl}
          muted={!audioOn || volume <= 0}
          playsInline
          preload="metadata"
          onLoadStart={() => setLocalVideoLoading(true)}
          onWaiting={() => setLocalVideoLoading(true)}
          onCanPlay={() => setLocalVideoLoading(false)}
          onPlaying={() => setLocalVideoLoading(false)}
          onLoadedMetadata={(e) => {
            setLocalVideoLoading(false);
            const vid = e.currentTarget;
            vid.volume = Math.min(1, Math.max(0, volume));
            vid.playbackRate = playbackRate;
            const dur = Number.isFinite(vid.duration) && vid.duration > 0 ? vid.duration : 0;
            const safeStart = dur > 2 ? Math.min(clip.startTimeSec, Math.max(0, dur - 2)) : 0;
            if (safeStart > 0.1) {
              vid.currentTime = safeStart;
            }
          }}
          onError={() => {
            setLocalVideoLoading(false);
            setLocalVideoFailed(true);
            setIsPlaying(false);
          }}
          className="w-full h-full object-cover"
          style={{
            objectPosition: `${clip.focalPointX}% center`,
            transform: `scale(${clip.zoomScale})`,
          }}
        />
      );
    }

    if (useYouTubeEmbed) {
      return (
        <div className="relative w-full h-full overflow-hidden bg-black">
          {/* Keep thumbnail visible until YouTube iframe is actively playing */}
          {(!isPlaying || !ytPlaying) && safeThumbnailUrl && !imgFailed && (
            <img
              src={safeThumbnailUrl}
              alt={clip.title}
              referrerPolicy="no-referrer"
              onError={() => setImgFailed(true)}
              className={`absolute inset-0 z-[1] w-full h-full object-cover ${
                isPlaying ? "animate-studio-pan" : ""
              }`}
              style={{
                objectPosition: `${clip.focalPointX}% center`,
                transform: `scale(${clip.zoomScale})`,
              }}
            />
          )}
          {ytActivated && (
            <div
              className="absolute inset-0 flex items-center justify-center pointer-events-none"
              style={{
                transform: `translateX(${ytCropShift}%) scale(${
                  clip.aspectRatio === "9:16" ? clip.zoomScale * 1.95 : clip.zoomScale * 1.25
                })`,
              }}
            >
              <div id={`yt-${ytDomId}`} className="w-[460px] h-[260px]" />
            </div>
          )}
        </div>
      );
    }

    if (!imgFailed && safeThumbnailUrl) {
      return (
        <img
          src={safeThumbnailUrl}
          alt={clip.title}
          referrerPolicy="no-referrer"
          onError={() => setImgFailed(true)}
          className={`w-full h-full object-cover transition-transform duration-300 ${
            isPlaying ? "animate-studio-pan" : ""
          }`}
          style={{
            objectPosition: `${clip.focalPointX}% center`,
            transform: `scale(${clip.zoomScale})`,
          }}
        />
      );
    }

    return (
      <div className="w-full h-full bg-gradient-to-br from-zinc-800 via-zinc-900 to-black flex flex-col items-center justify-center p-4 text-center">
        <Film className="w-8 h-8 text-zinc-500 mb-2" />
        <span className="text-xs text-zinc-400 font-medium line-clamp-2">{clip.title}</span>
      </div>
    );
  };

  return (
    <div
      ref={containerRef}
      className={`relative ${widthClass} ${
        isFullscreen ? "" : aspectClass
      } rounded-xl overflow-hidden bg-[#0E0E12] border border-[#27272E] shrink-0 group select-none`}
    >
      {/* Visual Layer */}
      {clip.splitScreen && clip.aspectRatio === "9:16" ? (
        <div className="absolute inset-0 flex flex-col">
          <div className="relative h-1/2 w-full overflow-hidden bg-zinc-900">
            {renderPrimaryVideoLayer()}
          </div>
          <div className="relative h-1/2 w-full overflow-hidden border-t border-black/60 bg-zinc-950">
            <img
              src={safeSplitBgThumb}
              alt={splitBg.name}
              referrerPolicy="no-referrer"
              className={`w-full h-full object-cover ${isPlaying ? "animate-bg-drift" : ""}`}
            />
          </div>
        </div>
      ) : (
        <div className="absolute inset-0 overflow-hidden bg-zinc-950">
          {renderPrimaryVideoLayer()}
        </div>
      )}

      {/* Contrast Scrim */}
      <div className="absolute inset-0 z-[2] bg-gradient-to-b from-black/70 via-black/10 to-black/85 pointer-events-none" />

      {/* Top Auto Hook Overlay */}
      {clip.showAutoHook && clip.hookTitle && (
        <div className="absolute top-3 left-3 right-3 z-10 pointer-events-none flex justify-center">
          <div className="bg-black/80 backdrop-blur-xs border border-white/10 rounded-md px-2.5 py-1.5 text-center shadow-lg max-w-full">
            <p className="font-display font-extrabold text-[11px] sm:text-xs tracking-wide uppercase text-white leading-tight">
              {clip.hookTitle}
            </p>
          </div>
        </div>
      )}

      {/* Buffering / Loading Indicator */}
      {isBuffering && !hasVideoSourceError && (
        <div className="absolute inset-0 z-15 flex items-center justify-center pointer-events-none">
          <div className="px-2.5 py-1 rounded-full bg-black/75 border border-white/15 text-[11px] text-zinc-200 inline-flex items-center gap-1.5 backdrop-blur-xs">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-400" />
            Loading video...
          </div>
        </div>
      )}

      {/* Error State & Retry Overlay */}
      {hasVideoSourceError && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-black/75 backdrop-blur-xs p-4 text-center">
          <AlertCircle className="w-6 h-6 text-amber-400" />
          <p className="text-xs text-zinc-200 font-medium">
            Preview stream could not load
          </p>
          <button
            type="button"
            onClick={handleRetrySource}
            className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-[11px] font-semibold text-white inline-flex items-center gap-1.5 transition-colors"
          >
            <RotateCcw className="w-3 h-3" />
            Retry preview
          </button>
        </div>
      )}

      {/* Center Play / Pause Button */}
      {!hasVideoSourceError && (
        <button
          type="button"
          onClick={() => {
            if (useYouTubeEmbed && !ytActivated) {
              setYtActivated(true);
            }
            setIsPlaying((p) => !p);
          }}
          aria-label={isPlaying ? "Pause clip preview" : "Play clip preview"}
          className={`absolute inset-0 z-10 flex items-center justify-center transition-opacity duration-150 ${
            isPlaying ? "opacity-0 group-hover:opacity-100" : "opacity-100"
          }`}
        >
          <span className="w-12 h-12 rounded-full bg-black/70 hover:bg-blue-600 border border-white/25 flex items-center justify-center text-white backdrop-blur-xs transition-colors">
            {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
          </span>
        </button>
      )}

      {/* Animated Caption Overlay */}
      {activeCue && (
        <div
          className={`absolute left-3 right-3 z-10 pointer-events-none flex justify-center ${
            clip.splitScreen && clip.aspectRatio === "9:16" ? "top-1/2 -translate-y-1/2" : "bottom-12"
          }`}
        >
          <CaptionPreview
            styleId={clip.captionStyle}
            text={activeCue.text}
            emphasisWords={activeCue.emphasisWords}
            activeWordIndex={activeWordIndex}
            compact={clip.aspectRatio === "16:9"}
          />
        </div>
      )}

      {/* Bottom Scrubber, Volume, Speed & Fullscreen Controls */}
      <div className="absolute bottom-0 inset-x-0 z-20 px-2.5 pb-2 pt-5 bg-gradient-to-t from-black/95 via-black/75 to-transparent flex flex-col gap-1.5">
        <input
          type="range"
          min={0}
          max={effectiveDuration}
          step={0.1}
          value={currentTime}
          aria-label="Seek clip timeline"
          onChange={(e) => {
            const val = Number(e.target.value);
            setCurrentTime(val);
            if (videoRef.current) {
              const vid = videoRef.current;
              const dur = Number.isFinite(vid.duration) && vid.duration > 0 ? vid.duration : 0;
              const safeStart = dur > 2 ? Math.min(clip.startTimeSec, Math.max(0, dur - 2)) : 0;
              const target = dur > 0 ? Math.min(dur - 0.1, safeStart + val) : safeStart + val;
              vid.currentTime = Math.max(0, target);
            }
            if (ytPlayerRef.current && ytReady) {
              ytPlayerRef.current.seekTo(clip.startTimeSec + val, true);
            }
          }}
          className="w-full h-1 accent-blue-500 cursor-pointer bg-white/25 rounded-full"
        />
        <div className="flex items-center justify-between gap-1 text-[11px] font-mono tabular-nums text-zinc-300">
          <span className="truncate">
            {formatTime(currentTime)} / {formatTime(effectiveDuration)}
          </span>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={handleCycleSpeed}
              title="Change playback speed"
              aria-label={`Playback speed ${playbackRate}x`}
              className="px-1.5 py-0.5 rounded hover:bg-white/15 text-[10px] font-mono text-zinc-200 transition-colors"
            >
              {playbackRate}x
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setAudioOn((v) => !v);
              }}
              title={audioOn ? "Mute clip audio" : "Unmute clip audio"}
              aria-label={audioOn ? "Mute clip audio" : "Unmute clip audio"}
              className="p-1 rounded hover:bg-white/15 text-zinc-200 transition-colors"
            >
              {audioOn && volume > 0 ? (
                <Volume2 className="w-3.5 h-3.5 text-blue-400" />
              ) : (
                <VolumeX className="w-3.5 h-3.5 text-zinc-400" />
              )}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={audioOn ? volume : 0}
              aria-label="Preview volume"
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => {
                const nextVol = Number(e.target.value);
                setVolume(nextVol);
                setAudioOn(nextVol > 0);
              }}
              className="w-10 h-1 accent-blue-500 cursor-pointer bg-white/25 rounded-full hidden sm:block"
            />
            <button
              type="button"
              onClick={handleToggleFullscreen}
              title={isFullscreen ? "Exit fullscreen" : "Fullscreen preview"}
              aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen preview"}
              className="p-1 rounded hover:bg-white/15 text-zinc-200 transition-colors"
            >
              {isFullscreen ? (
                <Minimize2 className="w-3.5 h-3.5" />
              ) : (
                <Maximize2 className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
