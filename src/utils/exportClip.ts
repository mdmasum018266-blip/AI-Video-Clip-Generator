import { Muxer, ArrayBufferTarget } from "mp4-muxer";
import { ClipItem, VideoProject } from "../types";
import { ASSET_IMAGES, normalizeAssetUrl } from "../data/assetImages";
import { BACKGROUND_VIDEOS } from "../data/presets";
import { apiUrl } from "./api";

export function formatTime(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

export function parseTimeInput(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) {
    return parseInt(trimmed, 10) * 60;
  }
  const parts = trimmed.split(":").map((p) => Number(p));
  if (parts.some((n) => Number.isNaN(n) || n < 0)) return null;
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  return null;
}

export function isDirectVideoUrl(url?: string): boolean {
  return /\.(mp4|webm|mov|m4v|ogv)(\?.*)?$/i.test((url || "").trim());
}

function formatSubtitleTimestamp(sec: number, msSeparator: "," | "."): string {
  const msTotal = Math.max(0, Math.round(sec * 1000));
  const hours = Math.floor(msTotal / 3600000);
  const mins = Math.floor((msTotal % 3600000) / 60000);
  const secs = Math.floor((msTotal % 60000) / 1000);
  const ms = msTotal % 1000;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(
    secs
  ).padStart(2, "0")}${msSeparator}${String(ms).padStart(3, "0")}`;
}

export function downloadSrtSubtitles(clip: ClipItem) {
  const srt = clip.transcript
    .map((cue, idx) => {
      return `${idx + 1}\n${formatSubtitleTimestamp(
        cue.startOffsetSec,
        ","
      )} --> ${formatSubtitleTimestamp(cue.endOffsetSec, ",")}\n${cue.text}\n`;
    })
    .join("\n");

  triggerDownload(
    new Blob([srt], { type: "text/plain;charset=utf-8" }),
    `${slugify(clip.title)}.srt`
  );
}

export function downloadVttSubtitles(clip: ClipItem) {
  const cues = clip.transcript
    .map((cue) => {
      return `${formatSubtitleTimestamp(
        cue.startOffsetSec,
        "."
      )} --> ${formatSubtitleTimestamp(cue.endOffsetSec, ".")}\n${cue.text}\n`;
    })
    .join("\n");

  const vtt = `WEBVTT\n\n${cues}`;
  triggerDownload(
    new Blob([vtt], { type: "text/vtt;charset=utf-8" }),
    `${slugify(clip.title)}.vtt`
  );
}

export function downloadTranscriptTxt(clip: ClipItem) {
  const content = [
    `${clip.title}`,
    `Virality Score: ${clip.viralityScore}/100 (Hook: ${clip.hookStrength}, Pacing: ${clip.pacingScore})`,
    `Language: ${clip.language}`,
    `Auto Hook: ${clip.hookTitle}`,
    "",
    "--- Why This Works ---",
    clip.whyViral,
    "",
    "--- Transcript ---",
    ...clip.transcript.map(
      (c) => `[${formatTime(c.startOffsetSec)} - ${formatTime(c.endOffsetSec)}] ${c.text}`
    ),
  ].join("\n");

  triggerDownload(
    new Blob([content], { type: "text/plain;charset=utf-8" }),
    `${slugify(clip.title)}-transcript.txt`
  );
}

interface ImageCropRect {
  sx: number;
  sy: number;
  sw: number;
  sh: number;
}

interface ExportCanvasResources {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  img: HTMLImageElement | null;
  imgCrop: ImageCropRect | null;
  splitBgImg: HTMLImageElement | null;
  sourceVideo: HTMLVideoElement | null;
  videoSourceUrl: string | null;
  videoDurationSec: number;
  isPreCutSegment: boolean;
  cleanupSourceVideo: () => void;
}

function getExportDimensions(aspectRatio: ClipItem["aspectRatio"]) {
  // All dimensions are crisp HD and divisible by 16 for optimal H.264 encoding
  if (aspectRatio === "9:16") return { width: 720, height: 1280 };
  if (aspectRatio === "1:1") return { width: 720, height: 720 };
  return { width: 1280, height: 720 };
}

function resolveFullClipDurationSec(clip: ClipItem, maxRenderSec: number): number {
  const lastCueEnd = clip.transcript.reduce(
    (max, cue) => Math.max(max, Number(cue.endOffsetSec) || 0),
    0
  );
  return Math.min(Math.max(clip.durationSec || 0, lastCueEnd || 0, 5), maxRenderSec);
}

function detectLetterboxCrop(image: HTMLImageElement): ImageCropRect | null {
  const w = image.naturalWidth;
  const h = image.naturalHeight;
  if (w < 64 || h < 64) return null;

  try {
    const sampleW = 160;
    const sampleH = Math.max(90, Math.round((160 * h) / w));
    const probe = document.createElement("canvas");
    probe.width = sampleW;
    probe.height = sampleH;
    const pctx = probe.getContext("2d");
    if (!pctx) return null;

    pctx.drawImage(image, 0, 0, sampleW, sampleH);
    const pixels = pctx.getImageData(0, 0, sampleW, sampleH).data;

    const rowLuma = (y: number): number => {
      let sum = 0;
      const offset = y * sampleW * 4;
      for (let x = 0; x < sampleW; x += 2) {
        const i = offset + x * 4;
        sum += 0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2];
      }
      return sum / (sampleW / 2);
    };

    const maxScan = Math.floor(sampleH * 0.22);
    let topRows = 0;
    while (topRows < maxScan && rowLuma(topRows) < 16) {
      topRows++;
    }

    let bottomRows = 0;
    while (bottomRows < maxScan && rowLuma(sampleH - 1 - bottomRows) < 16) {
      bottomRows++;
    }

    // Only crop if clear horizontal letterbox bars exist on top and bottom
    if (topRows >= 4 && bottomRows >= 4 && sampleH - topRows - bottomRows >= sampleH * 0.55) {
      const sy = Math.round((topRows / sampleH) * h);
      const bottomPx = Math.round((bottomRows / sampleH) * h);
      const sh = Math.max(32, h - sy - bottomPx);
      return { sx: 0, sy, sw: w, sh };
    }
  } catch {
    // CORS-tainted canvas: skip auto-crop safely
  }

  return null;
}

function extractYouTubeIdFromText(raw?: string): string | null {
  if (!raw) return null;
  const thumbMatch = raw.match(/i\.ytimg\.com\/vi\/([a-zA-Z0-9_-]{6,})/);
  if (thumbMatch) return thumbMatch[1];
  return null;
}

async function prepareExportCanvasResources(
  clip: ClipItem,
  project: VideoProject,
  requestedDurationSec = 30,
  onProgress?: (pct: number) => void
): Promise<ExportCanvasResources> {
  const dims = getExportDimensions(clip.aspectRatio);
  const canvas = document.createElement("canvas");
  canvas.width = dims.width;
  canvas.height = dims.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas 2D context unavailable for export.");
  }

  const LOCAL_FALLBACK_THUMB = ASSET_IMAGES.demoPodcastAi;

  const loadImage = (src: string): Promise<HTMLImageElement | null> =>
    new Promise((resolve) => {
      const candidate = new Image();
      candidate.crossOrigin = "anonymous";
      let done = false;
      const timer = window.setTimeout(() => {
        if (!done) {
          done = true;
          resolve(null);
        }
      }, 5000);
      candidate.onload = () => {
        if (!done) {
          done = true;
          window.clearTimeout(timer);
          // YouTube maxresdefault returns a 120x90 grey placeholder when missing
          const isYtPlaceholder =
            src.includes("maxresdefault.jpg") &&
            candidate.naturalWidth <= 120 &&
            candidate.naturalHeight <= 90;
          resolve(candidate.naturalWidth > 0 && !isYtPlaceholder ? candidate : null);
        }
      };
      candidate.onerror = () => {
        if (!done) {
          done = true;
          window.clearTimeout(timer);
          resolve(null);
        }
      };
      candidate.src = src;
    });

  let sourceVideo: HTMLVideoElement | null = null;
  let videoDurationSec = 0;
  let img: HTMLImageElement | null = null;
  let splitBgImg: HTMLImageElement | null = null;

  const thumbSrc = normalizeAssetUrl(project.thumbnailUrl, LOCAL_FALLBACK_THUMB);
  const ytId = project.youtubeId || extractYouTubeIdFromText(thumbSrc);

  // Build ordered thumbnail candidates preferring HD 16:9 maxresdefault (no black bars)
  const thumbCandidates: string[] = [];
  if (ytId) {
    thumbCandidates.push(`https://i.ytimg.com/vi/${ytId}/maxresdefault.jpg`);
    thumbCandidates.push(`https://i.ytimg.com/vi/${ytId}/sddefault.jpg`);
  }
  thumbCandidates.push(thumbSrc);
  if (thumbSrc !== LOCAL_FALLBACK_THUMB) {
    thumbCandidates.push(LOCAL_FALLBACK_THUMB);
  }

  for (const candidateUrl of thumbCandidates) {
    const resolvedSrc = candidateUrl.startsWith("https://")
      ? apiUrl(`/api/video/thumbnail-proxy?url=${encodeURIComponent(candidateUrl)}`)
      : candidateUrl;
    img = await loadImage(resolvedSrc);
    if (!img && candidateUrl.startsWith("https://")) {
      img = await loadImage(candidateUrl);
    }
    if (img) break;
  }

  const imgCrop = img ? detectLetterboxCrop(img) : null;

  if (clip.splitScreen && clip.aspectRatio === "9:16") {
    const bgOption =
      BACKGROUND_VIDEOS.find((b) => b.id === clip.splitScreenBgId) || BACKGROUND_VIDEOS[0];
    splitBgImg = await loadImage(
      normalizeAssetUrl(bgOption.thumbnailUrl, ASSET_IMAGES.bgGameplayRunner)
    );
  }

  let candidateVideoUrl =
    project.localVideoUrl || (isDirectVideoUrl(project.url) ? project.url : undefined);
  let videoSourceUrl: string | null = null;
  let isPreCutSegment = false;
  let createdBlobUrl: string | null = null;

  // For YouTube / web video URL projects without a local file, fetch the real extracted MP4 segment
  if (!candidateVideoUrl && !project.isDemo && (project.youtubeId || project.url)) {
    const remoteTarget = project.youtubeId
      ? `https://www.youtube.com/watch?v=${project.youtubeId}`
      : project.url!;
    try {
      if (onProgress) onProgress(4);
      const controller = new AbortController();
      const fetchTimer = window.setTimeout(() => controller.abort(), 50000);
      const clipSrcUrl = apiUrl(
        `/api/video/clip-source?url=${encodeURIComponent(remoteTarget)}&start=${Math.max(
          0,
          Math.floor(clip.startTimeSec)
        )}&duration=${Math.min(Math.max(5, Math.ceil(requestedDurationSec)), 65)}`
      );
      const segRes = await fetch(clipSrcUrl, { signal: controller.signal });
      window.clearTimeout(fetchTimer);

      if (segRes.ok) {
        const segBlob = await segRes.blob();
        if (segBlob.size > 4096) {
          createdBlobUrl = URL.createObjectURL(segBlob);
          candidateVideoUrl = createdBlobUrl;
          isPreCutSegment = true;
        }
      }
    } catch {
      // Fallback smoothly to HD thumbnail mode if upstream stream cannot be extracted
    }
    if (onProgress) onProgress(12);
  }

  if (candidateVideoUrl) {
    const vid = document.createElement("video");
    vid.muted = true;
    vid.playsInline = true;
    vid.preload = "auto";
    if (candidateVideoUrl.startsWith("http")) {
      vid.crossOrigin = "anonymous";
    }
    vid.style.position = "fixed";
    vid.style.left = "-9999px";
    vid.style.top = "0";
    vid.style.width = "2px";
    vid.style.height = "2px";
    vid.style.opacity = "0.01";
    vid.style.pointerEvents = "none";
    document.body.appendChild(vid);

    const ready = await new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (ok: boolean) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve(ok);
      };
      const timer = window.setTimeout(() => finish(vid.readyState >= 2), 8000);

      vid.onloadeddata = () => {
        const dur = Number.isFinite(vid.duration) && vid.duration > 0 ? vid.duration : 0;
        const targetStart = isPreCutSegment
          ? 0
          : dur > 2
          ? Math.min(Math.max(0, clip.startTimeSec), Math.max(0, dur - 2))
          : 0;
        if (targetStart > 0.1) {
          const onSeeked = () => finish(true);
          vid.addEventListener("seeked", onSeeked, { once: true });
          try {
            vid.currentTime = targetStart;
          } catch {
            finish(true);
          }
        } else {
          finish(true);
        }
      };
      vid.onerror = () => finish(false);
      vid.src = candidateVideoUrl;
    });

    if (ready && vid.videoWidth > 0) {
      sourceVideo = vid;
      videoSourceUrl = candidateVideoUrl;
      videoDurationSec = Number.isFinite(vid.duration) && vid.duration > 0 ? vid.duration : 0;
    } else {
      vid.pause();
      vid.removeAttribute("src");
      vid.load();
      vid.remove();
    }
  }

  const cleanupSourceVideo = () => {
    if (sourceVideo) {
      sourceVideo.pause();
      sourceVideo.removeAttribute("src");
      sourceVideo.load();
      sourceVideo.remove();
      sourceVideo = null;
    }
    if (createdBlobUrl) {
      URL.revokeObjectURL(createdBlobUrl);
      createdBlobUrl = null;
    }
  };

  return {
    canvas,
    ctx,
    img,
    imgCrop,
    splitBgImg,
    sourceVideo,
    videoSourceUrl,
    videoDurationSec,
    isPreCutSegment,
    cleanupSourceVideo,
  };
}

function drawRoundedRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function wrapTextLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number
): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth || !current) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function drawAutoHookOverlay(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  hookTitle: string,
  scaleFactor: number
) {
  const cleanTitle = hookTitle.trim().toUpperCase();
  if (!cleanTitle) return;

  const fontSize = Math.round(24 * scaleFactor);
  ctx.save();
  ctx.font = `800 ${fontSize}px 'Plus Jakarta Sans', 'Inter', system-ui, sans-serif`;

  const maxBoxW = Math.round(canvas.width * 0.86);
  const padX = Math.round(24 * scaleFactor);
  const padY = Math.round(14 * scaleFactor);
  const lineH = Math.round(fontSize * 1.24);

  const lines = wrapTextLines(ctx, cleanTitle, maxBoxW - padX * 2).slice(0, 2);
  if (lines.length === 0) {
    ctx.restore();
    return;
  }

  const widestLine = lines.reduce(
    (max, line) => Math.max(max, ctx.measureText(line).width),
    0
  );
  const boxW = Math.min(maxBoxW, Math.ceil(widestLine + padX * 2));
  const boxH = lines.length * lineH + padY * 2;
  const boxX = Math.round((canvas.width - boxW) / 2);
  const boxY = Math.round(48 * scaleFactor);

  ctx.shadowColor = "rgba(0, 0, 0, 0.55)";
  ctx.shadowBlur = Math.round(20 * scaleFactor);
  ctx.shadowOffsetY = Math.round(6 * scaleFactor);
  drawRoundedRectPath(ctx, boxX, boxY, boxW, boxH, Math.round(14 * scaleFactor));
  ctx.fillStyle = "rgba(10, 10, 14, 0.86)";
  ctx.fill();

  ctx.shadowColor = "transparent";
  ctx.lineWidth = Math.max(1.5, 1.5 * scaleFactor);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.16)";
  ctx.stroke();

  ctx.fillStyle = "#FFFFFF";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  lines.forEach((line, idx) => {
    const lineY = boxY + padY + lineH * idx + lineH / 2;
    ctx.fillText(line, canvas.width / 2, lineY);
  });
  ctx.restore();
}

function drawStyledCaptionsOverlay(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  clip: ClipItem,
  simulatedTime: number,
  isSplitScreen: boolean,
  scaleFactor: number
) {
  if (!clip.transcript || clip.transcript.length === 0) return;

  const activeCue =
    clip.transcript.find(
      (c) => simulatedTime >= c.startOffsetSec && simulatedTime <= c.endOffsetSec
    ) ||
    [...clip.transcript].reverse().find((c) => c.startOffsetSec <= simulatedTime) ||
    clip.transcript[0];

  if (!activeCue || !activeCue.text.trim()) return;

  const allWords = activeCue.text.trim().split(/\s+/).filter(Boolean);
  if (allWords.length === 0) return;

  const cueStart = Number(activeCue.startOffsetSec) || 0;
  const cueEnd = Math.max(cueStart + 0.8, Number(activeCue.endOffsetSec) || cueStart + 3);
  const ratio = Math.min(0.999, Math.max(0, (simulatedTime - cueStart) / (cueEnd - cueStart)));
  const activeGlobalIdx = Math.floor(ratio * allWords.length);

  // Break long 10-18 word cues into fast-paced ~5-word phrases synchronized to time
  const maxChunkWords = clip.aspectRatio === "16:9" ? 8 : 5;
  const chunkIndex = Math.floor(activeGlobalIdx / maxChunkWords);
  const chunkStart = chunkIndex * maxChunkWords;
  const visibleWords = allWords.slice(chunkStart, chunkStart + maxChunkWords);
  const localActiveIdx = activeGlobalIdx - chunkStart;

  const emphasisSet = new Set(
    (activeCue.emphasisWords || [])
      .map((w) => w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ""))
      .filter(Boolean)
  );

  const styleId = clip.captionStyle;
  const isMinimal = styleId === "minimal-serif";
  const isBlueGlow = styleId === "blue-glow";
  const isItalic = styleId === "italic-red";
  const isCyanPill = styleId === "cyan-slide";
  const isRedPill = styleId === "red-spin";

  const baseFontSize = isMinimal
    ? Math.round(28 * scaleFactor)
    : clip.aspectRatio === "16:9"
    ? Math.round(32 * scaleFactor)
    : Math.round(36 * scaleFactor);

  const fontStyle = isItalic ? "italic " : "";
  const fontWeight = isMinimal ? "600" : "900";
  const fontFamily = isMinimal
    ? "'Georgia', 'Plus Jakarta Sans', serif"
    : "'Plus Jakarta Sans', 'Inter', system-ui, sans-serif";

  ctx.save();
  ctx.font = `${fontStyle}${fontWeight} ${baseFontSize}px ${fontFamily}`;

  const transformedWords = visibleWords.map((raw, idx) => {
    const clean = raw.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
    const highlighted =
      idx === localActiveIdx || (clean.length > 0 && emphasisSet.has(clean));
    let display = raw;
    if (!isMinimal && !isBlueGlow) {
      display = raw.toUpperCase();
    } else if (isBlueGlow) {
      display = highlighted ? raw.toUpperCase() : raw.toLowerCase();
    }
    return { display, highlighted };
  });

  const maxLineWidth = Math.round(canvas.width * 0.86);
  const spaceW = Math.round(baseFontSize * 0.28);
  const pillPadX = isCyanPill || isRedPill ? Math.round(9 * scaleFactor) : 0;

  type WordToken = { display: string; highlighted: boolean; width: number };
  const lines: WordToken[][] = [];
  let currentLine: WordToken[] = [];
  let currentLineWidth = 0;

  for (const token of transformedWords) {
    const textW = ctx.measureText(token.display).width;
    const tokenW = textW + (token.highlighted && (isCyanPill || isRedPill) ? pillPadX * 2 : 0);
    const addedW = (currentLine.length > 0 ? spaceW : 0) + tokenW;
    if (currentLine.length > 0 && currentLineWidth + addedW > maxLineWidth) {
      lines.push(currentLine);
      currentLine = [{ ...token, width: tokenW }];
      currentLineWidth = tokenW;
    } else {
      currentLine.push({ ...token, width: tokenW });
      currentLineWidth += addedW;
    }
  }
  if (currentLine.length > 0) lines.push(currentLine);

  const lineHeight = Math.round(baseFontSize * 1.32);
  const totalBlockH = lines.length * lineHeight;
  const anchorCenterY = isSplitScreen
    ? Math.round(canvas.height * 0.5)
    : Math.round(canvas.height * 0.81);
  const startY = anchorCenterY - totalBlockH / 2 + lineHeight / 2;

  if (isMinimal) {
    const widest = lines.reduce(
      (max, line) =>
        Math.max(
          max,
          line.reduce((s, t, i) => s + t.width + (i > 0 ? spaceW : 0), 0)
        ),
      0
    );
    const cardPadX = Math.round(22 * scaleFactor);
    const cardPadY = Math.round(12 * scaleFactor);
    const cardW = Math.min(maxLineWidth + cardPadX * 2, widest + cardPadX * 2);
    const cardH = totalBlockH + cardPadY * 2;
    drawRoundedRectPath(
      ctx,
      Math.round((canvas.width - cardW) / 2),
      Math.round(anchorCenterY - cardH / 2),
      cardW,
      cardH,
      Math.round(12 * scaleFactor)
    );
    ctx.fillStyle = "rgba(0, 0, 0, 0.78)";
    ctx.fill();
  }

  const accentColor =
    styleId === "cyan-slide"
      ? "#22D3EE"
      : styleId === "italic-red" || styleId === "red-spin"
      ? "#EF4444"
      : styleId === "violet"
      ? "#A78BFA"
      : styleId === "blue-glow"
      ? "#60A5FA"
      : styleId === "emerald-pop"
      ? "#34D399"
      : styleId === "minimal-serif"
      ? "#FCD34D"
      : "#FACC15";

  ctx.textAlign = "left";
  ctx.textBaseline = "middle";

  lines.forEach((line, lineIdx) => {
    const lineW = line.reduce((sum, t, i) => sum + t.width + (i > 0 ? spaceW : 0), 0);
    let cursorX = Math.round((canvas.width - lineW) / 2);
    const y = Math.round(startY + lineIdx * lineHeight);

    for (const token of line) {
      if (token.highlighted && (isCyanPill || isRedPill)) {
        const pillH = Math.round(baseFontSize * 1.18);
        drawRoundedRectPath(
          ctx,
          cursorX,
          Math.round(y - pillH / 2),
          token.width,
          pillH,
          Math.round(8 * scaleFactor)
        );
        ctx.fillStyle = isCyanPill ? "#22D3EE" : "#DC2626";
        ctx.fill();

        ctx.fillStyle = isCyanPill ? "#09090B" : "#FFFFFF";
        ctx.fillText(token.display, cursorX + pillPadX, y);
      } else {
        if (!isMinimal) {
          ctx.lineJoin = "round";
          ctx.lineWidth = Math.max(5, Math.round(7 * scaleFactor));
          ctx.strokeStyle = "rgba(0, 0, 0, 0.94)";
          ctx.strokeText(token.display, cursorX, y);
        }

        if (token.highlighted && (styleId === "violet" || isBlueGlow)) {
          ctx.shadowColor = styleId === "violet" ? "rgba(167,139,250,0.8)" : "rgba(59,130,246,0.9)";
          ctx.shadowBlur = Math.round(16 * scaleFactor);
        } else if (!isMinimal) {
          ctx.shadowColor = "rgba(0,0,0,0.85)";
          ctx.shadowBlur = Math.round(8 * scaleFactor);
          ctx.shadowOffsetY = Math.round(3 * scaleFactor);
        } else {
          ctx.shadowColor = "transparent";
        }

        ctx.fillStyle = token.highlighted ? accentColor : "#FFFFFF";
        ctx.fillText(token.display, cursorX, y);
        ctx.shadowColor = "transparent";
      }

      cursorX += token.width + spaceW;
    }
  });

  ctx.restore();
}

function drawClipExportFrame(
  resources: ExportCanvasResources,
  clip: ClipItem,
  progress: number,
  simulatedTime: number
) {
  const { canvas, ctx, img, imgCrop, splitBgImg, sourceVideo } = resources;
  const scaleFactor = Math.min(canvas.width, canvas.height) / 540;

  ctx.fillStyle = "#09090B";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const isSplitScreen = clip.splitScreen && clip.aspectRatio === "9:16";
  const primaryRegionH = isSplitScreen ? canvas.height / 2 : canvas.height;

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, canvas.width, primaryRegionH);
  ctx.clip();

  if (sourceVideo && sourceVideo.videoWidth > 0 && sourceVideo.readyState >= 2) {
    const scale =
      Math.max(
        canvas.width / sourceVideo.videoWidth,
        primaryRegionH / sourceVideo.videoHeight
      ) * clip.zoomScale;
    const drawW = sourceVideo.videoWidth * scale;
    const drawH = sourceVideo.videoHeight * scale;
    const overflowX = Math.max(0, drawW - canvas.width);
    const offsetX = -(overflowX * (clip.focalPointX / 100));
    const offsetY = (primaryRegionH - drawH) / 2;
    ctx.drawImage(sourceVideo, offsetX, offsetY, drawW, drawH);
  } else if (img && img.naturalWidth > 0) {
    const sx = imgCrop ? imgCrop.sx : 0;
    const sy = imgCrop ? imgCrop.sy : 0;
    const sw = imgCrop ? imgCrop.sw : img.naturalWidth;
    const sh = imgCrop ? imgCrop.sh : img.naturalHeight;

    // Smooth Ken Burns zoom + horizontal pan across the clean cropped image
    const motionZoom = 1.04 + Math.sin(progress * Math.PI) * 0.08;
    const scale =
      Math.max(canvas.width / sw, primaryRegionH / sh) * clip.zoomScale * motionZoom;
    const drawW = sw * scale;
    const drawH = sh * scale;
    const overflowX = Math.max(0, drawW - canvas.width);
    const panShift = Math.sin(progress * Math.PI * 2) * 0.1;
    const clampedFocal = Math.min(100, Math.max(0, clip.focalPointX + panShift * 100));
    const offsetX = -(overflowX * (clampedFocal / 100));
    const offsetY = (primaryRegionH - drawH) / 2;
    ctx.drawImage(img, sx, sy, sw, sh, offsetX, offsetY, drawW, drawH);
  }
  ctx.restore();

  if (isSplitScreen && splitBgImg && splitBgImg.naturalWidth > 0) {
    const bgTop = primaryRegionH;
    const bgH = canvas.height - bgTop;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, bgTop, canvas.width, bgH);
    ctx.clip();
    const driftZoom = 1.08 + Math.cos(progress * Math.PI * 2) * 0.04;
    const bgScale =
      Math.max(canvas.width / splitBgImg.naturalWidth, bgH / splitBgImg.naturalHeight) *
      driftZoom;
    const bgDrawW = splitBgImg.naturalWidth * bgScale;
    const bgDrawH = splitBgImg.naturalHeight * bgScale;
    const bgOverflowX = Math.max(0, bgDrawW - canvas.width);
    const bgShift = (Math.sin(progress * Math.PI * 2) + 1) / 2;
    const bgOffsetX = -(bgOverflowX * bgShift);
    const bgOffsetY = bgTop + (bgH - bgDrawH) / 2;
    ctx.drawImage(splitBgImg, bgOffsetX, bgOffsetY, bgDrawW, bgDrawH);
    ctx.restore();
  }

  // Subtle top + bottom contrast scrim for readable hook & captions
  const scrimGrad = ctx.createLinearGradient(0, 0, 0, canvas.height);
  scrimGrad.addColorStop(0, "rgba(0,0,0,0.45)");
  scrimGrad.addColorStop(0.22, "rgba(0,0,0,0)");
  scrimGrad.addColorStop(0.62, "rgba(0,0,0,0)");
  scrimGrad.addColorStop(1, "rgba(0,0,0,0.78)");
  ctx.fillStyle = scrimGrad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (clip.showAutoHook && clip.hookTitle) {
    drawAutoHookOverlay(ctx, canvas, clip.hookTitle, scaleFactor);
  }

  drawStyledCaptionsOverlay(ctx, canvas, clip, simulatedTime, isSplitScreen, scaleFactor);
}

async function seekVideoTo(vid: HTMLVideoElement, timeSec: number): Promise<void> {
  if (Math.abs(vid.currentTime - timeSec) < 0.015 && vid.readyState >= 2) {
    return;
  }
  await new Promise<void>((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      vid.removeEventListener("seeked", done);
      resolve();
    };
    const timer = window.setTimeout(done, 450);
    vid.addEventListener("seeked", done, { once: true });
    try {
      vid.currentTime = timeSec;
    } catch {
      done();
    }
  });
}

async function extractClipAudioSegment(
  videoSourceUrl: string | null,
  startSec: number,
  durationSec: number
): Promise<{ audioBuffer: AudioBuffer; startSample: number; endSample: number } | null> {
  if (!videoSourceUrl || typeof AudioContext === "undefined") return null;
  let audioCtx: AudioContext | null = null;
  try {
    const res = await fetch(videoSourceUrl);
    if (!res.ok) return null;
    const rawBuf = await res.arrayBuffer();
    audioCtx = new AudioContext();
    const audioBuffer = await audioCtx.decodeAudioData(rawBuf);
    if (audioBuffer.numberOfChannels === 0 || audioBuffer.length === 0) {
      return null;
    }
    const startSample = Math.min(
      Math.max(0, Math.floor(startSec * audioBuffer.sampleRate)),
      Math.max(0, audioBuffer.length - 1)
    );
    const desiredSamples = Math.floor(durationSec * audioBuffer.sampleRate);
    const endSample = Math.min(audioBuffer.length, startSample + desiredSamples);
    if (endSample - startSample < 512) return null;
    return { audioBuffer, startSample, endSample };
  } catch {
    return null;
  } finally {
    if (audioCtx) {
      audioCtx.close().catch(() => {});
    }
  }
}

async function recordCanvasWithMediaRecorder(
  resources: ExportCanvasResources,
  clip: ClipItem,
  candidateMimes: string[],
  fallbackMime: string,
  errorLabel: string,
  onProgress?: (pct: number) => void,
  maxRenderSec = 65
): Promise<Blob> {
  const { canvas, sourceVideo, cleanupSourceVideo } = resources;

  if (typeof MediaRecorder === "undefined" || typeof canvas.captureStream !== "function") {
    cleanupSourceVideo();
    throw new Error(
      `Your browser does not support in-browser ${errorLabel} recording (MediaRecorder).`
    );
  }

  const supportedMime = candidateMimes.find((t) => MediaRecorder.isTypeSupported(t));
  if (candidateMimes.length > 0 && !supportedMime && fallbackMime === "") {
    cleanupSourceVideo();
    throw new Error(`${errorLabel} is not supported by this browser.`);
  }

  const canvasStream = canvas.captureStream(24);
  const tracks: MediaStreamTrack[] = [...canvasStream.getVideoTracks()];
  let audioCtx: AudioContext | null = null;

  if (sourceVideo && typeof AudioContext !== "undefined") {
    try {
      audioCtx = new AudioContext();
      const sourceNode = audioCtx.createMediaElementSource(sourceVideo);
      const destNode = audioCtx.createMediaStreamDestination();
      // Route ONLY to MediaStreamDestination (not speakers) so export stays silent
      sourceNode.connect(destNode);
      sourceVideo.muted = false;
      tracks.push(...destNode.stream.getAudioTracks());
    } catch {
      if (audioCtx) {
        audioCtx.close().catch(() => {});
        audioCtx = null;
      }
      sourceVideo.muted = true;
    }
  }

  const combinedStream = new MediaStream(tracks);
  const recorder = supportedMime
    ? new MediaRecorder(combinedStream, { mimeType: supportedMime })
    : new MediaRecorder(combinedStream);
  const chunks: BlobPart[] = [];

  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  const renderDurationSec = resolveFullClipDurationSec(clip, maxRenderSec);
  const fps = 24;
  const totalFrames = Math.round(renderDurationSec * fps);

  if (sourceVideo) {
    await sourceVideo.play().catch(() => {});
  }

  const cleanupMedia = () => {
    cleanupSourceVideo();
    combinedStream.getTracks().forEach((t) => t.stop());
    if (audioCtx) {
      audioCtx.close().catch(() => {});
      audioCtx = null;
    }
  };

  return new Promise<Blob>((resolve, reject) => {
    let frameTimer = 0;
    let stopped = false;

    const safetyTimer = window.setTimeout(() => {
      if (!stopped && recorder.state !== "inactive") {
        recorder.stop();
      }
    }, (renderDurationSec + 12) * 1000);

    recorder.onstop = () => {
      stopped = true;
      window.clearTimeout(frameTimer);
      window.clearTimeout(safetyTimer);
      cleanupMedia();
      const blob = new Blob(chunks, { type: supportedMime || fallbackMime });
      if (blob.size === 0) {
        reject(new Error("Rendered video was empty. Please try again in Chrome or Edge."));
        return;
      }
      resolve(blob);
    };
    recorder.onerror = () => {
      stopped = true;
      window.clearTimeout(frameTimer);
      window.clearTimeout(safetyTimer);
      cleanupMedia();
      reject(new Error("Video recording failed."));
    };

    recorder.start(250);
    let frame = 0;

    const drawFrame = () => {
      if (stopped) return;
      if (frame >= totalFrames) {
        if (onProgress) onProgress(100);
        if (recorder.state !== "inactive") {
          recorder.stop();
        }
        return;
      }

      const progress = frame / totalFrames;
      const simulatedTime = progress * renderDurationSec;
      if (onProgress) onProgress(12 + Math.round(progress * 88));

      drawClipExportFrame(resources, clip, progress, simulatedTime);

      frame++;
      frameTimer = window.setTimeout(drawFrame, 1000 / fps);
    };

    drawFrame();
  });
}

/**
 * Renders a WebM Blob in the browser via Canvas + MediaRecorder (used both for file download
 * and automatic social platform upload).
 */
export async function renderWebmClipBlob(
  clip: ClipItem,
  project: VideoProject,
  onProgress?: (pct: number) => void,
  maxRenderSec = 65
): Promise<Blob> {
  const renderDurationSec = resolveFullClipDurationSec(clip, maxRenderSec);
  const resources = await prepareExportCanvasResources(
    clip,
    project,
    renderDurationSec,
    onProgress
  );
  return recordCanvasWithMediaRecorder(
    resources,
    clip,
    ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"],
    "video/webm",
    "WebM video",
    onProgress,
    maxRenderSec
  );
}

/**
 * Renders a genuine HD H.264 MP4 Blob (+ AAC audio when source media has audio)
 * using WebCodecs + mp4-muxer, falling back to native MP4 MediaRecorder when available.
 */
export async function renderMp4ClipBlob(
  clip: ClipItem,
  project: VideoProject,
  onProgress?: (pct: number) => void,
  maxRenderSec = 65
): Promise<Blob> {
  const renderDurationSec = resolveFullClipDurationSec(clip, maxRenderSec);
  const resources = await prepareExportCanvasResources(
    clip,
    project,
    renderDurationSec,
    onProgress
  );
  const {
    canvas,
    sourceVideo,
    videoSourceUrl,
    videoDurationSec,
    isPreCutSegment,
    cleanupSourceVideo,
  } = resources;
  const fps = 24;
  const totalFrames = Math.round(renderDurationSec * fps);

  // Path A: WebCodecs VideoEncoder (+ optional AudioEncoder) + mp4-muxer
  if (typeof VideoEncoder !== "undefined" && typeof VideoFrame !== "undefined") {
    const h264Candidates = [
      "avc1.640028",
      "avc1.4d002a",
      "avc1.42E01E",
      "avc1.42001f",
      "avc1.42001e",
    ];
    let selectedVideoConfig: VideoEncoderConfig | null = null;

    for (const codec of h264Candidates) {
      try {
        const candidate: VideoEncoderConfig = {
          codec,
          width: canvas.width,
          height: canvas.height,
          bitrate: 4_000_000,
          framerate: fps,
        };
        const support = await VideoEncoder.isConfigSupported(candidate);
        if (support.supported) {
          selectedVideoConfig = support.config || candidate;
          break;
        }
      } catch {
        // Probe next H.264 profile
      }
    }

    if (selectedVideoConfig) {
      const targetStart = isPreCutSegment
        ? 0
        : videoDurationSec > 2
        ? Math.min(Math.max(0, clip.startTimeSec), Math.max(0, videoDurationSec - 2))
        : 0;

      // Prepare AAC audio track if source video has audio and AudioEncoder supports AAC
      let audioSegment: { audioBuffer: AudioBuffer; startSample: number; endSample: number } | null =
        null;
      let audioConfig: AudioEncoderConfig | null = null;

      if (sourceVideo && videoSourceUrl && typeof AudioEncoder !== "undefined" && typeof AudioData !== "undefined") {
        audioSegment = await extractClipAudioSegment(
          videoSourceUrl,
          targetStart,
          renderDurationSec
        );
        if (audioSegment) {
          const channels = Math.min(2, audioSegment.audioBuffer.numberOfChannels);
          const candidateAudio: AudioEncoderConfig = {
            codec: "mp4a.40.2",
            sampleRate: audioSegment.audioBuffer.sampleRate,
            numberOfChannels: channels,
            bitrate: 128_000,
          };
          try {
            const support = await AudioEncoder.isConfigSupported(candidateAudio);
            if (support.supported) {
              audioConfig = support.config || candidateAudio;
            }
          } catch {
            audioConfig = null;
          }
        }
      }

      const target = new ArrayBufferTarget();
      const muxer = new Muxer({
        target,
        video: {
          codec: "avc",
          width: canvas.width,
          height: canvas.height,
          frameRate: fps,
        },
        ...(audioConfig
          ? {
              audio: {
                codec: "aac",
                numberOfChannels: audioConfig.numberOfChannels,
                sampleRate: audioConfig.sampleRate,
              },
            }
          : {}),
        fastStart: "in-memory",
      });

      let encoderError: Error | null = null;
      const videoEncoder = new VideoEncoder({
        output: (chunk, meta) => {
          muxer.addVideoChunk(chunk, meta);
        },
        error: (err) => {
          encoderError = err instanceof Error ? err : new Error(String(err));
        },
      });

      let audioEncoder: AudioEncoder | null = null;
      if (audioConfig) {
        audioEncoder = new AudioEncoder({
          output: (chunk, meta) => {
            muxer.addAudioChunk(chunk, meta);
          },
          error: (err) => {
            encoderError = err instanceof Error ? err : new Error(String(err));
          },
        });
      }

      try {
        videoEncoder.configure(selectedVideoConfig);
        if (audioEncoder && audioConfig) {
          audioEncoder.configure(audioConfig);
        }

        const frameDurationUs = Math.round(1_000_000 / fps);

        // Encode video frames deterministically (frame-accurate seek when sourceVideo exists)
        for (let frame = 0; frame < totalFrames; frame++) {
          if (encoderError) throw encoderError;

          const progress = frame / totalFrames;
          const simulatedTime = progress * renderDurationSec;
          const pctSpan = audioEncoder ? 76 : 84;
          if (onProgress) onProgress(12 + Math.round(progress * pctSpan));

          if (sourceVideo) {
            const maxVidTime = videoDurationSec > 0.1 ? videoDurationSec - 0.05 : targetStart + simulatedTime;
            const seekTarget = Math.min(Math.max(0, targetStart + simulatedTime), maxVidTime);
            await seekVideoTo(sourceVideo, seekTarget);
          }

          drawClipExportFrame(resources, clip, progress, simulatedTime);

          const timestampUs = Math.round(frame * frameDurationUs);
          const vf = new VideoFrame(canvas, {
            timestamp: timestampUs,
            duration: frameDurationUs,
          });
          try {
            videoEncoder.encode(vf, { keyFrame: frame % (fps * 2) === 0 });
          } finally {
            vf.close();
          }

          while (videoEncoder.encodeQueueSize > 8) {
            await new Promise((r) => window.setTimeout(r, 10));
            if (encoderError) throw encoderError;
          }

          if (!sourceVideo && frame % 4 === 0) {
            await new Promise((r) => window.setTimeout(r, 0));
          }
        }

        // Encode audio slice when available
        if (audioEncoder && audioConfig && audioSegment) {
          const { audioBuffer, startSample, endSample } = audioSegment;
          const channels = audioConfig.numberOfChannels;
          const sampleRate = audioBuffer.sampleRate;
          const totalAudioSamples = endSample - startSample;
          const chunkFrames = 1024;
          let offset = 0;

          while (offset < totalAudioSamples) {
            if (encoderError) throw encoderError;
            const framesNow = Math.min(chunkFrames, totalAudioSamples - offset);
            const planarBuffer = new ArrayBuffer(framesNow * channels * 4);
            const planar = new Float32Array(planarBuffer);

            for (let ch = 0; ch < channels; ch++) {
              const chData = audioBuffer.getChannelData(ch);
              const slice = chData.subarray(
                startSample + offset,
                startSample + offset + framesNow
              );
              planar.set(slice, ch * framesNow);
            }

            const timestampUs = Math.round((offset / sampleRate) * 1_000_000);
            const audioData = new AudioData({
              format: "f32-planar",
              sampleRate,
              numberOfFrames: framesNow,
              numberOfChannels: channels,
              timestamp: timestampUs,
              data: planar,
            });
            try {
              audioEncoder.encode(audioData);
            } finally {
              audioData.close();
            }

            offset += framesNow;
            if (onProgress) {
              onProgress(88 + Math.round((offset / totalAudioSamples) * 8));
            }
          }
          await audioEncoder.flush();
        }

        await videoEncoder.flush();
        if (encoderError) throw encoderError;
        muxer.finalize();
        if (onProgress) onProgress(100);

        const mp4Blob = new Blob([target.buffer], { type: "video/mp4" });
        if (mp4Blob.size === 0) {
          throw new Error("Rendered MP4 file was empty.");
        }
        return mp4Blob;
      } finally {
        if (videoEncoder.state !== "closed") {
          try {
            videoEncoder.close();
          } catch {
            // Ignore cleanup errors
          }
        }
        if (audioEncoder && audioEncoder.state !== "closed") {
          try {
            audioEncoder.close();
          } catch {
            // Ignore cleanup errors
          }
        }
        cleanupSourceVideo();
      }
    }
  }

  // Path B: Native MediaRecorder MP4 (e.g. Safari)
  const mp4Mimes = ["video/mp4;codecs=avc1", "video/mp4"];
  const hasNativeMp4Recorder =
    typeof MediaRecorder !== "undefined" &&
    mp4Mimes.some((m) => MediaRecorder.isTypeSupported(m));

  if (hasNativeMp4Recorder) {
    return recordCanvasWithMediaRecorder(
      resources,
      clip,
      mp4Mimes,
      "",
      "MP4 (H.264)",
      onProgress,
      maxRenderSec
    );
  }

  cleanupSourceVideo();
  throw new Error(
    "MP4 (H.264) export is not supported in this browser. Please use Video (.webm) or open in Chrome, Edge, or Safari."
  );
}

export async function renderAndDownloadWebmClip(
  clip: ClipItem,
  project: VideoProject,
  onProgress?: (pct: number) => void
): Promise<void> {
  const blob = await renderWebmClipBlob(clip, project, onProgress, 65);
  triggerDownload(
    blob,
    `${slugify(clip.title)}-${clip.aspectRatio.replace(":", "x")}.webm`
  );
}

export async function renderAndDownloadMp4Clip(
  clip: ClipItem,
  project: VideoProject,
  onProgress?: (pct: number) => void
): Promise<void> {
  const blob = await renderMp4ClipBlob(clip, project, onProgress, 65);
  triggerDownload(
    blob,
    `${slugify(clip.title)}-${clip.aspectRatio.replace(":", "x")}.mp4`
  );
}

export async function downloadCoverPng(
  clip: ClipItem,
  project: VideoProject
): Promise<void> {
  const resources = await prepareExportCanvasResources(clip, project, 5);
  try {
    const firstCueTime = clip.transcript[0]?.startOffsetSec ?? 0.5;
    drawClipExportFrame(resources, clip, 0.15, firstCueTime + 0.1);
    const pngBlob = await new Promise<Blob>((resolve, reject) => {
      resources.canvas.toBlob((blob) => {
        if (blob && blob.size > 0) {
          resolve(blob);
        } else {
          reject(new Error("Could not generate PNG cover image."));
        }
      }, "image/png");
    });
    triggerDownload(
      pngBlob,
      `${slugify(clip.title)}-${clip.aspectRatio.replace(":", "x")}-cover.png`
    );
  } finally {
    resources.cleanupSourceVideo();
  }
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      const idx = result.indexOf(",");
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.onerror = () => reject(new Error("Failed to encode video blob."));
    reader.readAsDataURL(blob);
  });
}

function slugify(str: string): string {
  return (
    str
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || "scalereach-clip"
  );
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
