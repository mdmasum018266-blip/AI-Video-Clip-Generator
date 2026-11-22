import { ClipItem, VideoProject } from "../types";
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

function formatSrtTimestamp(sec: number): string {
  const msTotal = Math.max(0, Math.round(sec * 1000));
  const hours = Math.floor(msTotal / 3600000);
  const mins = Math.floor((msTotal % 3600000) / 60000);
  const secs = Math.floor((msTotal % 60000) / 1000);
  const ms = msTotal % 1000;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}:${String(
    secs
  ).padStart(2, "0")},${String(ms).padStart(3, "0")}`;
}

export function downloadSrtSubtitles(clip: ClipItem) {
  const srt = clip.transcript
    .map((cue, idx) => {
      return `${idx + 1}\n${formatSrtTimestamp(cue.startOffsetSec)} --> ${formatSrtTimestamp(
        cue.endOffsetSec
      )}\n${cue.text}\n`;
    })
    .join("\n");

  triggerDownload(
    new Blob([srt], { type: "text/plain;charset=utf-8" }),
    `${slugify(clip.title)}.srt`
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

/**
 * Renders a WebM Blob in the browser via Canvas + MediaRecorder (used both for file download
 * and automatic social platform upload).
 */
export async function renderWebmClipBlob(
  clip: ClipItem,
  project: VideoProject,
  onProgress?: (pct: number) => void,
  maxRenderSec = 10
): Promise<Blob> {
  const dims =
    clip.aspectRatio === "9:16"
      ? { width: 540, height: 960 }
      : clip.aspectRatio === "1:1"
      ? { width: 720, height: 720 }
      : { width: 960, height: 540 };

  const canvas = document.createElement("canvas");
  canvas.width = dims.width;
  canvas.height = dims.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas 2D context unavailable for video export.");
  }

  const LOCAL_FALLBACK_THUMB = "/src/assets/images/demo_podcast_ai_1795261139145.jpg";

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
          resolve(candidate.naturalWidth > 0 ? candidate : null);
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
  let img: HTMLImageElement | null = null;

  // Always preload a fallback thumbnail so export never renders black frames
  const thumbSrc = project.thumbnailUrl || LOCAL_FALLBACK_THUMB;
  if (thumbSrc.startsWith("https://")) {
    img = await loadImage(apiUrl(`/api/video/thumbnail-proxy?url=${encodeURIComponent(thumbSrc)}`));
  }
  if (!img) {
    img = await loadImage(thumbSrc);
  }
  if (!img && thumbSrc !== LOCAL_FALLBACK_THUMB) {
    img = await loadImage(LOCAL_FALLBACK_THUMB);
  }

  if (project.localVideoUrl) {
    const vid = document.createElement("video");
    vid.src = project.localVideoUrl;
    vid.muted = true;
    vid.playsInline = true;
    vid.preload = "auto";
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
      const timer = window.setTimeout(() => finish(vid.readyState >= 2), 5000);

      vid.onloadeddata = () => {
        const dur = Number.isFinite(vid.duration) && vid.duration > 0 ? vid.duration : 0;
        const targetStart =
          dur > 2 ? Math.min(Math.max(0, clip.startTimeSec), Math.max(0, dur - 2)) : 0;
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
    });

    if (ready && vid.videoWidth > 0) {
      sourceVideo = vid;
    } else {
      vid.pause();
      vid.removeAttribute("src");
      vid.load();
      vid.remove();
    }
  }

  if (typeof MediaRecorder === "undefined" || typeof canvas.captureStream !== "function") {
    if (sourceVideo) {
      sourceVideo.pause();
      sourceVideo.remove();
    }
    throw new Error(
      "Your browser does not support in-browser WebM video recording (MediaRecorder)."
    );
  }

  const candidateTypes = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ];
  const supportedMime = candidateTypes.find((t) => MediaRecorder.isTypeSupported(t));
  const stream = canvas.captureStream(24);
  const recorder = supportedMime
    ? new MediaRecorder(stream, { mimeType: supportedMime })
    : new MediaRecorder(stream);
  const chunks: BlobPart[] = [];

  recorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) chunks.push(e.data);
  };

  const renderDurationSec = Math.min(Math.max(clip.durationSec, 5), maxRenderSec);
  const fps = 24;
  const totalFrames = Math.round(renderDurationSec * fps);

  if (sourceVideo) {
    await sourceVideo.play().catch(() => {});
  }

  const cleanupMedia = () => {
    if (sourceVideo) {
      sourceVideo.pause();
      sourceVideo.removeAttribute("src");
      sourceVideo.load();
      sourceVideo.remove();
      sourceVideo = null;
    }
    stream.getTracks().forEach((t) => t.stop());
  };

  return new Promise<Blob>((resolve, reject) => {
    let frameTimer = 0;
    let stopped = false;

    const safetyTimer = window.setTimeout(() => {
      if (!stopped && recorder.state !== "inactive") {
        recorder.stop();
      }
    }, (renderDurationSec + 10) * 1000);

    recorder.onstop = () => {
      stopped = true;
      window.clearTimeout(frameTimer);
      window.clearTimeout(safetyTimer);
      cleanupMedia();
      const blob = new Blob(chunks, { type: supportedMime || "video/webm" });
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
      if (onProgress) onProgress(Math.round(progress * 100));

      ctx.fillStyle = "#09090B";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      if (sourceVideo && sourceVideo.videoWidth > 0 && sourceVideo.readyState >= 2) {
        const scale =
          Math.max(
            canvas.width / sourceVideo.videoWidth,
            canvas.height / sourceVideo.videoHeight
          ) * clip.zoomScale;
        const drawW = sourceVideo.videoWidth * scale;
        const drawH = sourceVideo.videoHeight * scale;
        const overflowX = Math.max(0, drawW - canvas.width);
        const offsetX = -(overflowX * (clip.focalPointX / 100));
        const offsetY = (canvas.height - drawH) / 2;
        ctx.drawImage(sourceVideo, offsetX, offsetY, drawW, drawH);
      } else if (img && img.naturalWidth > 0) {
        // Subtle Ken Burns motion so static-thumbnail exports do not appear frozen
        const motionZoom = 1 + Math.sin(progress * Math.PI) * 0.06;
        const scale =
          Math.max(canvas.width / img.naturalWidth, canvas.height / img.naturalHeight) *
          clip.zoomScale *
          motionZoom;
        const drawW = img.naturalWidth * scale;
        const drawH = img.naturalHeight * scale;
        const overflowX = Math.max(0, drawW - canvas.width);
        const panShift = Math.sin(progress * Math.PI * 2) * 0.08;
        const clampedFocal = Math.min(100, Math.max(0, clip.focalPointX + panShift * 100));
        const offsetX = -(overflowX * (clampedFocal / 100));
        const offsetY = (canvas.height - drawH) / 2;
        ctx.drawImage(img, offsetX, offsetY, drawW, drawH);
      }

      const grad = ctx.createLinearGradient(0, canvas.height * 0.45, 0, canvas.height);
      grad.addColorStop(0, "rgba(0,0,0,0)");
      grad.addColorStop(1, "rgba(0,0,0,0.8)");
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      if (clip.showAutoHook && clip.hookTitle) {
        ctx.fillStyle = "rgba(10,10,12,0.82)";
        const boxW = canvas.width * 0.84;
        const boxX = (canvas.width - boxW) / 2;
        ctx.fillRect(boxX, 42, boxW, 64);
        ctx.fillStyle = "#FFFFFF";
        ctx.font = "700 22px 'Plus Jakarta Sans', sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(clip.hookTitle.slice(0, 36), canvas.width / 2, 74, boxW - 24);
      }

      const activeCue =
        clip.transcript.find(
          (c) => simulatedTime >= c.startOffsetSec && simulatedTime <= c.endOffsetSec
        ) || clip.transcript[0];

      if (activeCue) {
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const accent =
          clip.captionStyle === "cyan-slide"
            ? "#22D3EE"
            : clip.captionStyle === "italic-red" || clip.captionStyle === "red-spin"
            ? "#EF4444"
            : clip.captionStyle === "violet"
            ? "#A78BFA"
            : clip.captionStyle === "blue-glow"
            ? "#60A5FA"
            : clip.captionStyle === "emerald-pop"
            ? "#34D399"
            : "#FACC15";

        ctx.font = "800 28px 'Plus Jakarta Sans', sans-serif";
        const words = activeCue.text.split(" ");
        const mid = Math.ceil(words.length / 2);
        const line1 = words.slice(0, mid).join(" ");
        const line2 = words.slice(mid).join(" ");

        ctx.lineWidth = 6;
        ctx.strokeStyle = "rgba(0,0,0,0.9)";
        ctx.strokeText(line1, canvas.width / 2, canvas.height - 150, canvas.width - 48);
        ctx.fillStyle = "#FFFFFF";
        ctx.fillText(line1, canvas.width / 2, canvas.height - 150, canvas.width - 48);

        if (line2) {
          ctx.strokeText(line2, canvas.width / 2, canvas.height - 110, canvas.width - 48);
          ctx.fillStyle = accent;
          ctx.fillText(line2, canvas.width / 2, canvas.height - 110, canvas.width - 48);
        }
      }

      frame++;
      frameTimer = window.setTimeout(drawFrame, 1000 / fps);
    };

    drawFrame();
  });
}

export async function renderAndDownloadWebmClip(
  clip: ClipItem,
  project: VideoProject,
  onProgress?: (pct: number) => void
): Promise<void> {
  const blob = await renderWebmClipBlob(clip, project, onProgress, 16);
  triggerDownload(
    blob,
    `${slugify(clip.title)}-${clip.aspectRatio.replace(":", "x")}.webm`
  );
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
