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

interface SceneFrame {
  img: HTMLImageElement;
  crop: ImageCropRect | null;
}

interface AudioSegmentSlice {
  audioBuffer: AudioBuffer;
  startSample: number;
  endSample: number;
}

export type ExportProgressCallback = (pct: number, stage?: string) => void;

interface ExportCanvasResources {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  img: HTMLImageElement | null;
  imgCrop: ImageCropRect | null;
  sceneFrames: SceneFrame[];
  splitBgImg: HTMLImageElement | null;
  sourceVideo: HTMLVideoElement | null;
  videoSourceUrl: string | null;
  videoDurationSec: number;
  isPreCutSegment: boolean;
  audioSegment: AudioSegmentSlice | null;
  audioEnvelope: number[] | null;
  effectiveRenderDurationSec: number;
  captionTimeScale: number;
  clipSourceError: string | null;
  voiceoverError: string | null;
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

function computeAudioEnvelope(
  audioBuffer: AudioBuffer,
  startSample: number,
  endSample: number,
  bucketCount: number
): number[] {
  const totalSamples = Math.max(1, endSample - startSample);
  const safeBuckets = Math.max(12, bucketCount);
  const chData = audioBuffer.getChannelData(0);
  const envelope: number[] = new Array(safeBuckets).fill(0);
  let maxRms = 0.01;

  for (let b = 0; b < safeBuckets; b++) {
    const s0 = startSample + Math.floor((b / safeBuckets) * totalSamples);
    const s1 = Math.min(endSample, Math.max(s0 + 1, startSample + Math.floor(((b + 1) / safeBuckets) * totalSamples)));
    let sumSq = 0;
    const step = Math.max(1, Math.floor((s1 - s0) / 64));
    let count = 0;
    for (let i = s0; i < s1; i += step) {
      const val = chData[i] || 0;
      sumSq += val * val;
      count++;
    }
    const rms = count > 0 ? Math.sqrt(sumSq / count) : 0;
    envelope[b] = rms;
    if (rms > maxRms) maxRms = rms;
  }

  return envelope.map((v) => Math.min(1, v / maxRms));
}

async function fetchVoiceoverAudioBuffer(
  clip: ClipItem
): Promise<{ buffer: AudioBuffer | null; error: string | null }> {
  if (typeof AudioContext === "undefined") {
    return { buffer: null, error: "Web Audio API unavailable in this browser." };
  }
  const spokenScript =
    clip.transcript
      .map((c) => c.text.trim())
      .filter(Boolean)
      .join(" ")
      .trim() ||
    clip.hookTitle ||
    clip.title;
  if (!spokenScript) {
    return { buffer: null, error: "No transcript text available for voiceover." };
  }

  let audioCtx: AudioContext | null = null;
  try {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 35000);
    const res = await fetch(apiUrl("/api/clips/voiceover"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: spokenScript,
        language: clip.language || "English",
      }),
      signal: controller.signal,
    });
    window.clearTimeout(timer);
    if (!res.ok) {
      const errJson = await res.json().catch(() => null);
      return {
        buffer: null,
        error: errJson?.error || `Voiceover request failed (${res.status})`,
      };
    }

    const wavBytes = await res.arrayBuffer();
    if (wavBytes.byteLength < 64) {
      return { buffer: null, error: "Voiceover audio response was empty." };
    }
    audioCtx = new AudioContext();
    const decoded = await audioCtx.decodeAudioData(wavBytes);
    if (decoded.numberOfChannels === 0 || decoded.length === 0) {
      return { buffer: null, error: "Decoded voiceover had no audio channels." };
    }
    return { buffer: decoded, error: null };
  } catch (err) {
    return {
      buffer: null,
      error: err instanceof Error ? err.message : "Failed to load AI voiceover.",
    };
  } finally {
    if (audioCtx) {
      audioCtx.close().catch(() => {});
    }
  }
}

async function resampleAudioSegment(
  segment: AudioSegmentSlice,
  targetSampleRate: number,
  targetChannels?: number
): Promise<AudioSegmentSlice> {
  const { audioBuffer, startSample, endSample } = segment;
  const channels = targetChannels ?? Math.min(2, audioBuffer.numberOfChannels);
  if (
    audioBuffer.sampleRate === targetSampleRate &&
    audioBuffer.numberOfChannels === channels
  ) {
    return segment;
  }
  if (typeof OfflineAudioContext === "undefined") {
    return segment;
  }
  const srcFrames = Math.max(1, endSample - startSample);
  const srcDurationSec = srcFrames / audioBuffer.sampleRate;
  const targetFrames = Math.max(1, Math.ceil(srcDurationSec * targetSampleRate));

  const offline = new OfflineAudioContext(channels, targetFrames, targetSampleRate);
  const srcChCount = Math.min(2, audioBuffer.numberOfChannels);
  const sliceBuf = offline.createBuffer(channels, srcFrames, audioBuffer.sampleRate);
  for (let ch = 0; ch < channels; ch++) {
    const srcChannelIdx = ch < srcChCount ? ch : 0;
    const src = audioBuffer.getChannelData(srcChannelIdx).subarray(startSample, endSample);
    sliceBuf.getChannelData(ch).set(src);
  }
  const source = offline.createBufferSource();
  source.buffer = sliceBuf;
  source.connect(offline.destination);
  source.start(0);
  const rendered = await offline.startRendering();
  return {
    audioBuffer: rendered,
    startSample: 0,
    endSample: rendered.length,
  };
}

function computeAudioPeakAmplitude(segment: AudioSegmentSlice): number {
  const { audioBuffer, startSample, endSample } = segment;
  let peak = 0;
  for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
    const data = audioBuffer.getChannelData(ch);
    const step = Math.max(1, Math.floor((endSample - startSample) / 16000));
    for (let i = startSample; i < endSample; i += step) {
      const v = Math.abs(data[i] || 0);
      if (v > peak) peak = v;
    }
  }
  return peak;
}

function normalizeAndAlignAudioSegment(
  segment: AudioSegmentSlice,
  targetDurationSec: number
): AudioSegmentSlice | null {
  const peak = computeAudioPeakAmplitude(segment);
  if (peak < 0.0005) {
    return null;
  }

  const { audioBuffer, startSample, endSample } = segment;
  const sr = audioBuffer.sampleRate;
  const channels = Math.min(2, Math.max(1, audioBuffer.numberOfChannels));
  const targetFrames = Math.max(1, Math.round(targetDurationSec * sr));
  const copyFrames = Math.min(targetFrames, Math.max(1, endSample - startSample));
  const gain = peak < 0.45 ? Math.min(2.8, 0.85 / peak) : peak > 0.96 ? 0.94 / peak : 1;
  const fadeSamples = Math.min(Math.floor(sr * 0.015), Math.floor(copyFrames / 4));

  const outBuf = new AudioBuffer({
    length: targetFrames,
    numberOfChannels: channels,
    sampleRate: sr,
  });

  for (let ch = 0; ch < channels; ch++) {
    const src = audioBuffer.getChannelData(Math.min(ch, audioBuffer.numberOfChannels - 1));
    const dst = outBuf.getChannelData(ch);
    for (let i = 0; i < copyFrames; i++) {
      let val = (src[startSample + i] || 0) * gain;
      if (gain > 1 && Math.abs(val) > 0.85) {
        val = Math.tanh(val);
      }
      if (fadeSamples > 0) {
        if (i < fadeSamples) {
          val *= i / fadeSamples;
        } else if (i >= copyFrames - fadeSamples) {
          val *= Math.max(0, (copyFrames - 1 - i) / fadeSamples);
        }
      }
      dst[i] = Math.max(-0.98, Math.min(0.98, val));
    }
  }

  return {
    audioBuffer: outBuf,
    startSample: 0,
    endSample: targetFrames,
  };
}

function sampleCanvasFrameSignature(canvas: HTMLCanvasElement): string {
  const probe = document.createElement("canvas");
  probe.width = 16;
  probe.height = 16;
  const pctx = probe.getContext("2d");
  if (!pctx) return "";
  pctx.drawImage(canvas, 0, 0, 16, 16);
  const data = pctx.getImageData(0, 0, 16, 16).data;
  let sig = "";
  for (let i = 0; i < data.length; i += 8) {
    const luma = Math.round(
      (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 12
    );
    sig += luma.toString(36);
  }
  return sig;
}

export interface Mp4ContainerInspection {
  hasFtyp: boolean;
  hasMoov: boolean;
  hasMdat: boolean;
  hasVideoTrack: boolean;
  hasAudioTrack: boolean;
}

export function validateMp4ContainerBuffer(
  buffer: ArrayBuffer,
  requireAudio: boolean
): Mp4ContainerInspection {
  if (buffer.byteLength < 64) {
    throw new Error("MP4 output buffer is too small to be a valid video file.");
  }
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);

  const readType = (offset: number): string =>
    String.fromCharCode(
      bytes[offset],
      bytes[offset + 1],
      bytes[offset + 2],
      bytes[offset + 3]
    );

  const readBox = (
    offset: number,
    limit: number
  ): { type: string; headerSize: number; boxEnd: number } | null => {
    if (offset + 8 > limit) return null;
    const rawSize = view.getUint32(offset, false);
    const type = readType(offset + 4);
    let totalSize = rawSize;
    let headerSize = 8;
    if (rawSize === 1) {
      if (offset + 16 > limit) return null;
      const hi = view.getUint32(offset + 8, false);
      const lo = view.getUint32(offset + 12, false);
      totalSize = hi * 4294967296 + lo;
      headerSize = 16;
    } else if (rawSize === 0) {
      totalSize = limit - offset;
    }
    if (totalSize < headerSize || offset + totalSize > limit) {
      return null;
    }
    return { type, headerSize, boxEnd: offset + totalSize };
  };

  let hasFtyp = false;
  let hasMoov = false;
  let hasMdat = false;
  let hasVideoTrack = false;
  let hasAudioTrack = false;

  const containerBoxes = new Set(["moov", "trak", "mdia", "minf", "stbl", "udta", "edts"]);
  const scanRange = (start: number, end: number, depth: number) => {
    if (depth > 8) return;
    let cursor = start;
    while (cursor + 8 <= end) {
      const box = readBox(cursor, end);
      if (!box) break;
      if (depth === 0) {
        if (box.type === "ftyp") hasFtyp = true;
        if (box.type === "moov") hasMoov = true;
        if (box.type === "mdat" && box.boxEnd - (cursor + box.headerSize) > 64) {
          hasMdat = true;
        }
      }
      if (box.type === "hdlr" && cursor + box.headerSize + 12 <= box.boxEnd) {
        const handlerType = readType(cursor + box.headerSize + 8);
        if (handlerType === "vide") hasVideoTrack = true;
        if (handlerType === "soun") hasAudioTrack = true;
      }
      if (containerBoxes.has(box.type)) {
        scanRange(cursor + box.headerSize, box.boxEnd, depth + 1);
      }
      cursor = box.boxEnd;
    }
  };

  scanRange(0, bytes.byteLength, 0);

  if (!hasFtyp || !hasMoov || !hasMdat) {
    throw new Error("MP4 container validation failed: missing ftyp, moov, or mdat atom.");
  }
  if (!hasVideoTrack) {
    throw new Error("MP4 container validation failed: no playable video track found.");
  }
  if (requireAudio && !hasAudioTrack) {
    throw new Error("MP4 container validation failed: audio track is missing from exported MP4.");
  }

  return { hasFtyp, hasMoov, hasMdat, hasVideoTrack, hasAudioTrack };
}

async function validateExportedMp4Blob(
  blob: Blob,
  options: { requireAudio: boolean; minDurationSec: number }
): Promise<Mp4ContainerInspection> {
  if (!blob || blob.size < 4096) {
    throw new Error("Exported MP4 file was empty or incomplete.");
  }
  const ab = await blob.arrayBuffer();
  const inspection = validateMp4ContainerBuffer(ab, options.requireAudio);

  // Verify browser can actually parse metadata, dimensions, and playable duration
  if (typeof document !== "undefined") {
    const probeUrl = URL.createObjectURL(blob);
    const probeVid = document.createElement("video");
    probeVid.muted = true;
    probeVid.playsInline = true;
    probeVid.preload = "metadata";
    try {
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const finish = (err?: Error) => {
          if (settled) return;
          settled = true;
          window.clearTimeout(timer);
          if (err) reject(err);
          else resolve();
        };
        const timer = window.setTimeout(
          () => finish(new Error("Timed out verifying exported MP4 playback metadata.")),
          6000
        );
        probeVid.onloadedmetadata = () => {
          if (probeVid.videoWidth <= 0 || probeVid.videoHeight <= 0) {
            finish(new Error("Exported MP4 has zero video dimensions."));
            return;
          }
          if (!Number.isFinite(probeVid.duration) || probeVid.duration < Math.min(0.8, options.minDurationSec * 0.4)) {
            finish(new Error("Exported MP4 duration is invalid or truncated."));
            return;
          }
          finish();
        };
        probeVid.onerror = () => finish(new Error("Exported MP4 could not be decoded by the browser player."));
        probeVid.src = probeUrl;
      });
    } finally {
      probeVid.removeAttribute("src");
      probeVid.load();
      URL.revokeObjectURL(probeUrl);
    }
  }

  // Verify audio track inside the finalized MP4 decodes non-silent samples when supported by Web Audio
  if (options.requireAudio && typeof AudioContext !== "undefined") {
    let audioCtx: AudioContext | null = null;
    try {
      audioCtx = new AudioContext();
      const decoded = await audioCtx.decodeAudioData(ab.slice(0));
      if (decoded.length === 0 || decoded.numberOfChannels === 0) {
        throw new Error("Exported MP4 audio track decoded with zero samples.");
      }
      const peak = computeAudioPeakAmplitude({
        audioBuffer: decoded,
        startSample: 0,
        endSample: decoded.length,
      });
      if (peak < 0.0003) {
        throw new Error("Exported MP4 audio track was completely silent.");
      }
    } catch (err) {
      // Only rethrow explicit silence/zero-sample failures; browsers that decode Opus-in-MP4
      // natively in <video> may reject Opus in AudioContext.decodeAudioData.
      if (
        err instanceof Error &&
        /(completely silent|zero samples|audio track is missing)/i.test(err.message)
      ) {
        throw err;
      }
    } finally {
      if (audioCtx) {
        audioCtx.close().catch(() => {});
      }
    }
  }

  return inspection;
}

async function prepareExportCanvasResources(
  clip: ClipItem,
  project: VideoProject,
  requestedDurationSec = 30,
  onProgress?: ExportProgressCallback,
  options: { includeAudio?: boolean; maxRenderSec?: number; allowSceneFallback?: boolean } = {}
): Promise<ExportCanvasResources> {
  const { includeAudio = true, maxRenderSec = 65, allowSceneFallback = false } = options;
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
          // YouTube returns a 120x90 grey placeholder when maxres/hq thumbnail slot doesn't exist
          const isYtPlaceholder =
            src.includes("ytimg.com") &&
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

  const loadRemoteOrLocalImage = async (candidateUrl: string): Promise<HTMLImageElement | null> => {
    const resolvedSrc = candidateUrl.startsWith("https://")
      ? apiUrl(`/api/video/thumbnail-proxy?url=${encodeURIComponent(candidateUrl)}`)
      : candidateUrl;
    let loaded = await loadImage(resolvedSrc);
    if (!loaded && candidateUrl.startsWith("https://")) {
      loaded = await loadImage(candidateUrl);
    }
    return loaded;
  };

  let sourceVideo: HTMLVideoElement | null = null;
  let videoDurationSec = 0;
  let img: HTMLImageElement | null = null;
  let splitBgImg: HTMLImageElement | null = null;
  const sceneFrames: SceneFrame[] = [];

  const thumbSrc = normalizeAssetUrl(project.thumbnailUrl, LOCAL_FALLBACK_THUMB);
  const ytId = project.youtubeId || extractYouTubeIdFromText(thumbSrc);

  // Build ordered primary thumbnail candidates preferring HD 16:9 maxresdefault (no black bars)
  const thumbCandidates: string[] = [];
  if (ytId) {
    thumbCandidates.push(`https://i.ytimg.com/vi/${ytId}/maxresdefault.jpg`);
    thumbCandidates.push(`https://i.ytimg.com/vi/${ytId}/sddefault.jpg`);
  }
  thumbCandidates.push(thumbSrc);
  if (thumbSrc !== LOCAL_FALLBACK_THUMB) {
    thumbCandidates.push(LOCAL_FALLBACK_THUMB);
  }

  // Load primary thumbnail + additional YouTube storyboard scene frames in parallel
  const primaryPromise = (async () => {
    for (const candidateUrl of thumbCandidates) {
      const loaded = await loadRemoteOrLocalImage(candidateUrl);
      if (loaded) return loaded;
    }
    return null;
  })();

  const ytScenePromise: Promise<HTMLImageElement[]> = ytId
    ? Promise.all(
        [1, 2, 3].map(async (slot) => {
          const hd = await loadRemoteOrLocalImage(`https://i.ytimg.com/vi/${ytId}/maxres${slot}.jpg`);
          if (hd) return hd;
          return loadRemoteOrLocalImage(`https://i.ytimg.com/vi/${ytId}/hq${slot}.jpg`);
        })
      ).then((arr) => arr.filter((x): x is HTMLImageElement => Boolean(x)))
    : Promise.resolve([]);

  const splitBgPromise =
    clip.splitScreen && clip.aspectRatio === "9:16"
      ? loadImage(
          normalizeAssetUrl(
            (BACKGROUND_VIDEOS.find((b) => b.id === clip.splitScreenBgId) || BACKGROUND_VIDEOS[0])
              .thumbnailUrl,
            ASSET_IMAGES.bgGameplayRunner
          )
        )
      : Promise.resolve(null);

  const [primaryImg, ytExtraImgs, resolvedSplitBg] = await Promise.all([
    primaryPromise,
    ytScenePromise,
    splitBgPromise,
  ]);

  img = primaryImg;
  splitBgImg = resolvedSplitBg;
  const imgCrop = img ? detectLetterboxCrop(img) : null;

  for (const frameImg of ytExtraImgs) {
    sceneFrames.push({ img: frameImg, crop: detectLetterboxCrop(frameImg) });
  }
  if (img) {
    sceneFrames.push({ img, crop: imgCrop });
  }

  let candidateVideoUrl =
    project.localVideoUrl || (isDirectVideoUrl(project.url) ? project.url : undefined);
  let videoSourceUrl: string | null = null;
  let isPreCutSegment = false;
  let createdBlobUrl: string | null = null;
  let preFetchedBlob: Blob | null = null;
  let clipSourceError: string | null = null;
  let voiceoverError: string | null = null;

  const isSyntheticDemoUrl =
    Boolean(project.isDemo) &&
    !project.youtubeId &&
    (!project.url || /watch\?v=demo_/i.test(project.url));

  // For YouTube / web video URL projects without a local file, extract the real MP4 segment first
  if (!candidateVideoUrl && !isSyntheticDemoUrl && (project.youtubeId || project.url)) {
    const remoteTarget = project.youtubeId
      ? `https://www.youtube.com/watch?v=${project.youtubeId}`
      : project.url!;
    try {
      onProgress?.(4, "Checking video...");
      const controller = new AbortController();
      const fetchTimer = window.setTimeout(() => controller.abort(), 75000);
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
          preFetchedBlob = segBlob;
          createdBlobUrl = URL.createObjectURL(segBlob);
          candidateVideoUrl = createdBlobUrl;
          isPreCutSegment = true;
        } else {
          clipSourceError = "Extracted source clip segment was empty.";
        }
      } else {
        const errJson = await segRes.json().catch(() => null);
        clipSourceError =
          errJson?.error || `Source video extraction failed (${segRes.status}).`;
      }
    } catch (err) {
      clipSourceError =
        err instanceof Error
          ? err.name === "AbortError"
            ? "Timed out waiting for source video stream."
            : err.message
          : "Could not extract source video segment.";
    }
    onProgress?.(8, "Checking video...");
  }

  if (candidateVideoUrl) {
    onProgress?.(8, "Loading video...");
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
      const timer = window.setTimeout(() => finish(vid.readyState >= 2), 12000);

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

    if (ready && vid.videoWidth > 0 && vid.videoHeight > 0) {
      sourceVideo = vid;
      videoSourceUrl = candidateVideoUrl;
      videoDurationSec = Number.isFinite(vid.duration) && vid.duration > 0 ? vid.duration : 0;
    } else {
      if (!clipSourceError) {
        clipSourceError = "Browser could not decode the video stream.";
      }
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

  if (!sourceVideo && !allowSceneFallback) {
    cleanupSourceVideo();
    if (isSyntheticDemoUrl) {
      throw new Error(
        "This sample demo project has no real video stream. Click 'Attach original MP4' or import a real YouTube/video file to export a full moving video."
      );
    }
    throw new Error(
      clipSourceError
        ? `Real moving video is unavailable (${clipSourceError}). Click 'Attach original MP4' to export with your source video.`
        : "Original moving video stream is unavailable for this clip. Click 'Attach original MP4' to export with moving frames."
    );
  }

  let effectiveRenderDurationSec = requestedDurationSec;
  if (sourceVideo && videoDurationSec > 1.5) {
    const startOffset = isPreCutSegment
      ? 0
      : videoDurationSec > 2
      ? Math.min(Math.max(0, clip.startTimeSec), Math.max(0, videoDurationSec - 2))
      : 0;
    const remainingSec = Math.max(1.5, videoDurationSec - startOffset);
    effectiveRenderDurationSec = Math.min(requestedDurationSec, remainingSec);
  }

  let audioSegment: AudioSegmentSlice | null = null;
  let audioEnvelope: number[] | null = null;
  let captionTimeScale = 1;

  if (includeAudio) {
    onProgress?.(9, "Preparing audio...");
    if (sourceVideo && videoSourceUrl) {
      const targetStart = isPreCutSegment
        ? 0
        : videoDurationSec > 2
        ? Math.min(Math.max(0, clip.startTimeSec), Math.max(0, videoDurationSec - 2))
        : 0;
      const extractedAudio = await extractClipAudioSegment(
        videoSourceUrl,
        targetStart,
        effectiveRenderDurationSec,
        preFetchedBlob
      );
      if (extractedAudio && computeAudioPeakAmplitude(extractedAudio) >= 0.0008) {
        audioSegment = extractedAudio;
      } else if (extractedAudio) {
        voiceoverError = "Source video audio track was silent.";
      }
    }

    // If source video had no audible audio track -> generate spoken AI voiceover via Gemini TTS
    if (!audioSegment) {
      onProgress?.(10, "Generating voiceover...");
      const ttsResult = await fetchVoiceoverAudioBuffer(clip);
      voiceoverError = ttsResult.error || voiceoverError;
      const voiceoverBuffer = ttsResult.buffer;
      if (voiceoverBuffer) {
        const voiceDur = voiceoverBuffer.duration;
        const cappedSamples = Math.min(
          voiceoverBuffer.length,
          Math.floor(maxRenderSec * voiceoverBuffer.sampleRate)
        );
        const candidateSlice: AudioSegmentSlice = {
          audioBuffer: voiceoverBuffer,
          startSample: 0,
          endSample: cappedSamples,
        };
        if (computeAudioPeakAmplitude(candidateSlice) >= 0.0005) {
          audioSegment = candidateSlice;
          if (!sourceVideo && voiceDur >= 4) {
            effectiveRenderDurationSec = Math.min(maxRenderSec, Math.max(5, voiceDur + 0.45));
          }
          const lastCueEnd = clip.transcript.reduce(
            (max, cue) => Math.max(max, Number(cue.endOffsetSec) || 0),
            0
          );
          if (lastCueEnd > 1 && voiceDur > 1) {
            captionTimeScale = Math.min(1.6, Math.max(0.65, voiceDur / lastCueEnd));
          }
        } else {
          voiceoverError = "Generated AI voiceover audio was silent.";
        }
      }
    }

    if (audioSegment) {
      audioSegment = normalizeAndAlignAudioSegment(audioSegment, effectiveRenderDurationSec);
    }

    if (!audioSegment && !allowSceneFallback) {
      cleanupSourceVideo();
      throw new Error(
        voiceoverError
          ? `Audio export blocked: ${voiceoverError} (cannot export a silent MP4 without voiceover/audio).`
          : "Audio export blocked: no audible source audio or AI voiceover was found for this clip."
      );
    }

    if (audioSegment) {
      audioEnvelope = computeAudioEnvelope(
        audioSegment.audioBuffer,
        audioSegment.startSample,
        audioSegment.endSample,
        Math.max(24, Math.round(effectiveRenderDurationSec * 24))
      );
    }
  }

  onProgress?.(12, "Preparing encoder...");

  return {
    canvas,
    ctx,
    img,
    imgCrop,
    sceneFrames,
    splitBgImg,
    sourceVideo,
    videoSourceUrl,
    videoDurationSec,
    isPreCutSegment,
    audioSegment,
    audioEnvelope,
    effectiveRenderDurationSec,
    captionTimeScale,
    clipSourceError,
    voiceoverError,
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

function drawSceneImageFrame(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  regionHeight: number,
  clip: ClipItem,
  frame: SceneFrame,
  sceneProgress: number,
  sceneIdx: number,
  alpha = 1
) {
  const { img, crop } = frame;
  if (!img || img.naturalWidth <= 0) return;

  const sx = crop ? crop.sx : 0;
  const sy = crop ? crop.sy : 0;
  const sw = crop ? crop.sw : img.naturalWidth;
  const sh = crop ? crop.sh : img.naturalHeight;

  const movePattern = sceneIdx % 4;
  let motionZoom = 1.05;
  let focalShift = 0;
  if (movePattern === 0) {
    motionZoom = 1.04 + sceneProgress * 0.1;
    focalShift = (sceneProgress - 0.5) * 14;
  } else if (movePattern === 1) {
    motionZoom = 1.14 - sceneProgress * 0.09;
    focalShift = (0.5 - sceneProgress) * 16;
  } else if (movePattern === 2) {
    motionZoom = 1.06 + Math.sin(sceneProgress * Math.PI) * 0.08;
    focalShift = (sceneProgress - 0.5) * 18;
  } else {
    motionZoom = 1.05 + sceneProgress * 0.11;
    focalShift = Math.sin(sceneProgress * Math.PI) * 10;
  }

  const scale =
    Math.max(canvasWidth / sw, regionHeight / sh) * clip.zoomScale * motionZoom;
  const drawW = sw * scale;
  const drawH = sh * scale;
  const overflowX = Math.max(0, drawW - canvasWidth);
  const clampedFocal = Math.min(100, Math.max(0, clip.focalPointX + focalShift));
  const offsetX = -(overflowX * (clampedFocal / 100));
  const offsetY = (regionHeight - drawH) / 2;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.drawImage(img, sx, sy, sw, sh, offsetX, offsetY, drawW, drawH);
  ctx.restore();
}

function drawVoiceoverWaveform(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  audioEnvelope: number[] | null,
  progress: number,
  isSplitScreen: boolean,
  scaleFactor: number
) {
  if (!audioEnvelope || audioEnvelope.length === 0) return;
  const barCount = 28;
  const barW = Math.max(3, Math.round(4 * scaleFactor));
  const gap = Math.max(3, Math.round(4.5 * scaleFactor));
  const totalW = barCount * barW + (barCount - 1) * gap;
  const startX = Math.round((canvas.width - totalW) / 2);
  const centerY = isSplitScreen
    ? Math.round(canvas.height * 0.42)
    : Math.round(canvas.height * 0.69);
  const maxBarH = Math.round(28 * scaleFactor);

  const envIdx = Math.min(
    audioEnvelope.length - 1,
    Math.max(0, Math.floor(progress * audioEnvelope.length))
  );
  const baseEnergy = audioEnvelope[envIdx] ?? 0.3;

  ctx.save();
  for (let i = 0; i < barCount; i++) {
    const wave =
      0.55 +
      0.45 *
        Math.abs(Math.sin(progress * Math.PI * 16 + i * 0.55 + (i % 3) * 0.8));
    const envelopeSample =
      audioEnvelope[
        Math.min(audioEnvelope.length - 1, Math.max(0, envIdx + Math.round((i - barCount / 2) * 0.35)))
      ] ?? baseEnergy;
    const amp = Math.max(0.14, Math.min(1, (baseEnergy * 0.65 + envelopeSample * 0.35) * wave));
    const h = Math.max(Math.round(5 * scaleFactor), Math.round(amp * maxBarH));
    const x = startX + i * (barW + gap);
    const y = Math.round(centerY - h / 2);

    drawRoundedRectPath(ctx, x, y, barW, h, Math.round(barW / 2));
    ctx.fillStyle =
      amp > 0.62 ? "rgba(59, 130, 246, 0.92)" : "rgba(255, 255, 255, 0.72)";
    ctx.fill();
  }
  ctx.restore();
}

function drawClipExportFrame(
  resources: ExportCanvasResources,
  clip: ClipItem,
  progress: number,
  simulatedTime: number
) {
  const {
    canvas,
    ctx,
    img,
    imgCrop,
    sceneFrames,
    splitBgImg,
    sourceVideo,
    audioEnvelope,
    captionTimeScale,
  } = resources;
  const scaleFactor = Math.min(canvas.width, canvas.height) / 540;

  ctx.fillStyle = "#09090B";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const isSplitScreen = clip.splitScreen && clip.aspectRatio === "9:16";
  const primaryRegionH = isSplitScreen ? canvas.height / 2 : canvas.height;

  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, canvas.width, primaryRegionH);
  ctx.clip();

  if (sourceVideo && sourceVideo.videoWidth > 0) {
    try {
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
    } catch {
      // Ignore single-frame video draw error
    }
  } else if (sceneFrames.length > 0) {
    const totalScenes = Math.max(sceneFrames.length, 4);
    const sceneFloat = progress * totalScenes;
    const currentSceneSlot = Math.min(totalScenes - 1, Math.floor(sceneFloat));
    const sceneLocalProgress = sceneFloat - currentSceneSlot;
    const currentFrame = sceneFrames[currentSceneSlot % sceneFrames.length];

    drawSceneImageFrame(
      ctx,
      canvas.width,
      primaryRegionH,
      clip,
      currentFrame,
      sceneLocalProgress,
      currentSceneSlot,
      1
    );

    if (sceneFrames.length > 1 && sceneLocalProgress > 0.82 && currentSceneSlot < totalScenes - 1) {
      const fadeAlpha = Math.min(1, (sceneLocalProgress - 0.82) / 0.18);
      const nextFrame = sceneFrames[(currentSceneSlot + 1) % sceneFrames.length];
      drawSceneImageFrame(
        ctx,
        canvas.width,
        primaryRegionH,
        clip,
        nextFrame,
        0,
        currentSceneSlot + 1,
        fadeAlpha
      );
    }
  } else if (img && img.naturalWidth > 0) {
    drawSceneImageFrame(
      ctx,
      canvas.width,
      primaryRegionH,
      clip,
      { img, crop: imgCrop },
      progress,
      0,
      1
    );
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

  // Subtle top timeline progress indicator
  ctx.fillStyle = "rgba(255, 255, 255, 0.16)";
  ctx.fillRect(0, 0, canvas.width, Math.max(3, Math.round(3 * scaleFactor)));
  ctx.fillStyle = "#3B82F6";
  ctx.fillRect(
    0,
    0,
    Math.round(canvas.width * Math.min(1, Math.max(0, progress))),
    Math.max(3, Math.round(3 * scaleFactor))
  );

  // When rendering multi-scene fallback with Gemini TTS voiceover, show live audio bars
  if (!sourceVideo && audioEnvelope) {
    drawVoiceoverWaveform(ctx, canvas, audioEnvelope, progress, isSplitScreen, scaleFactor);
  }

  if (clip.showAutoHook && clip.hookTitle) {
    drawAutoHookOverlay(ctx, canvas, clip.hookTitle, scaleFactor);
  }

  const syncedCaptionTime = captionTimeScale !== 1 ? simulatedTime / captionTimeScale : simulatedTime;
  drawStyledCaptionsOverlay(ctx, canvas, clip, syncedCaptionTime, isSplitScreen, scaleFactor);
}

async function seekVideoTo(vid: HTMLVideoElement, timeSec: number): Promise<void> {
  if (Math.abs(vid.currentTime - timeSec) < 0.015 && vid.readyState >= 2) {
    return;
  }
  await new Promise<void>((resolve) => {
    let settled = false;
    let seekDone = false;
    let pollTimer = 0;

    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(safetyTimer);
      window.clearInterval(pollTimer);
      vid.removeEventListener("seeked", onSeeked);
      vid.removeEventListener("canplay", onCanPlay);
      resolve();
    };

    const tryFinish = () => {
      if (seekDone && vid.readyState >= 2) {
        if (typeof window.requestAnimationFrame === "function") {
          window.requestAnimationFrame(() => finish());
        } else {
          finish();
        }
      }
    };

    const onSeeked = () => {
      seekDone = true;
      tryFinish();
      if (!settled && !pollTimer) {
        pollTimer = window.setInterval(() => {
          if (vid.readyState >= 2) tryFinish();
        }, 20);
      }
    };

    const onCanPlay = () => {
      tryFinish();
    };

    const safetyTimer = window.setTimeout(finish, 1200);
    vid.addEventListener("seeked", onSeeked);
    vid.addEventListener("canplay", onCanPlay);
    try {
      vid.currentTime = timeSec;
    } catch {
      finish();
    }
  });
}

async function extractClipAudioSegment(
  videoSourceUrl: string | null,
  startSec: number,
  durationSec: number,
  preFetchedBlob?: Blob | null
): Promise<AudioSegmentSlice | null> {
  if ((!videoSourceUrl && !preFetchedBlob) || typeof AudioContext === "undefined") return null;
  let audioCtx: AudioContext | null = null;
  try {
    let rawBuf: ArrayBuffer;
    if (preFetchedBlob) {
      rawBuf = await preFetchedBlob.arrayBuffer();
    } else {
      const res = await fetch(videoSourceUrl!);
      if (!res.ok) return null;
      rawBuf = await res.arrayBuffer();
    }
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
  onProgress?: ExportProgressCallback
): Promise<Blob> {
  const {
    canvas,
    sourceVideo,
    audioSegment,
    effectiveRenderDurationSec,
    cleanupSourceVideo,
  } = resources;

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
  let voiceSourceNode: AudioBufferSourceNode | null = null;

  // Prefer streaming pre-decoded AudioBuffer (from source video or AI voiceover) so sourceVideo
  // can remain muted and never gets blocked by browser async autoplay policies.
  if (audioSegment && typeof AudioContext !== "undefined") {
    try {
      audioCtx = new AudioContext();
      if (audioCtx.state === "suspended") {
        await audioCtx.resume().catch(() => {});
      }
      const { audioBuffer, startSample, endSample } = audioSegment;
      const frameLen = Math.max(1, endSample - startSample);
      const sliced = audioCtx.createBuffer(
        audioBuffer.numberOfChannels,
        frameLen,
        audioBuffer.sampleRate
      );
      for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
        sliced.getChannelData(ch).set(audioBuffer.getChannelData(ch).subarray(startSample, endSample));
      }
      voiceSourceNode = audioCtx.createBufferSource();
      voiceSourceNode.buffer = sliced;
      const destNode = audioCtx.createMediaStreamDestination();
      voiceSourceNode.connect(destNode);
      tracks.push(...destNode.stream.getAudioTracks());
    } catch {
      if (audioCtx) {
        audioCtx.close().catch(() => {});
        audioCtx = null;
      }
      voiceSourceNode = null;
    }
  } else if (sourceVideo && typeof AudioContext !== "undefined") {
    try {
      audioCtx = new AudioContext();
      const sourceNode = audioCtx.createMediaElementSource(sourceVideo);
      const destNode = audioCtx.createMediaStreamDestination();
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

  const renderDurationSec = effectiveRenderDurationSec;
  const fps = 24;
  const totalFrames = Math.round(renderDurationSec * fps);

  if (sourceVideo) {
    if (voiceSourceNode) {
      sourceVideo.muted = true;
    }
    await sourceVideo.play().catch(() => {});
  }

  const cleanupMedia = () => {
    cleanupSourceVideo();
    combinedStream.getTracks().forEach((t) => t.stop());
    if (voiceSourceNode) {
      try {
        voiceSourceNode.stop();
      } catch {
        // Ignore already stopped
      }
      voiceSourceNode = null;
    }
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
    if (voiceSourceNode) {
      try {
        voiceSourceNode.start();
      } catch {
        // Ignore start failure
      }
    }

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
      onProgress?.(12 + Math.round(progress * 86), "Encoding video...");

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
  onProgress?: ExportProgressCallback,
  maxRenderSec = 65
): Promise<Blob> {
  const renderDurationSec = resolveFullClipDurationSec(clip, maxRenderSec);
  const resources = await prepareExportCanvasResources(
    clip,
    project,
    renderDurationSec,
    onProgress,
    { includeAudio: true, maxRenderSec, allowSceneFallback: false }
  );
  return recordCanvasWithMediaRecorder(
    resources,
    clip,
    ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"],
    "video/webm",
    "WebM video",
    onProgress
  );
}

/**
 * Probes WebCodecs AudioEncoder support (trying AAC first, then 48kHz Opus fallback)
 * and resamples the audio slice when required.
 */
async function prepareMuxableAudioTrack(segment: AudioSegmentSlice): Promise<{
  muxerCodec: "aac" | "opus";
  encoderConfig: AudioEncoderConfig;
  segment: AudioSegmentSlice;
} | null> {
  if (typeof AudioEncoder === "undefined" || typeof AudioData === "undefined") {
    return null;
  }

  const nativeChannels = Math.min(2, segment.audioBuffer.numberOfChannels);
  const channelOptions = nativeChannels === 1 ? [1, 2] : [2, 1];
  const aacSampleRates = Array.from(
    new Set([segment.audioBuffer.sampleRate, 48000, 44100])
  );

  for (const chCount of channelOptions) {
    for (const sr of aacSampleRates) {
      const candidate: AudioEncoderConfig = {
        codec: "mp4a.40.2",
        sampleRate: sr,
        numberOfChannels: chCount,
        bitrate: 128_000,
      };
      try {
        const support = await AudioEncoder.isConfigSupported(candidate);
        if (support.supported) {
          const finalConfig = support.config || candidate;
          const targetSr = finalConfig.sampleRate || sr;
          const targetCh = finalConfig.numberOfChannels || chCount;
          const preparedSegment = await resampleAudioSegment(segment, targetSr, targetCh);
          return {
            muxerCodec: "aac",
            encoderConfig: finalConfig,
            segment: preparedSegment,
          };
        }
      } catch {
        // Probe next AAC profile
      }
    }
  }

  // Fallback to Opus (48kHz) when browser lacks proprietary AAC encoder
  for (const chCount of channelOptions) {
    const opusCandidate: AudioEncoderConfig = {
      codec: "opus",
      sampleRate: 48000,
      numberOfChannels: chCount,
      bitrate: 128_000,
    };
    try {
      const support = await AudioEncoder.isConfigSupported(opusCandidate);
      if (support.supported) {
        const finalConfig = support.config || opusCandidate;
        const targetSr = finalConfig.sampleRate || 48000;
        const targetCh = finalConfig.numberOfChannels || chCount;
        const preparedSegment = await resampleAudioSegment(segment, targetSr, targetCh);
        return {
          muxerCodec: "opus",
          encoderConfig: finalConfig,
          segment: preparedSegment,
        };
      }
    } catch {
      // Probe next channel count
    }
  }

  return null;
}

/**
 * Renders a genuine HD H.264 MP4 Blob (+ AAC/Opus audio from source video or AI voiceover)
 * using WebCodecs + mp4-muxer, falling back to native MP4 MediaRecorder when available.
 */
export async function renderMp4ClipBlob(
  clip: ClipItem,
  project: VideoProject,
  onProgress?: ExportProgressCallback,
  maxRenderSec = 65
): Promise<Blob> {
  const initialDurationSec = resolveFullClipDurationSec(clip, maxRenderSec);
  const resources = await prepareExportCanvasResources(
    clip,
    project,
    initialDurationSec,
    onProgress,
    { includeAudio: true, maxRenderSec, allowSceneFallback: false }
  );
  return encodePreparedMp4Resources(resources, clip, onProgress);
}

async function encodePreparedMp4Resources(
  resources: ExportCanvasResources,
  clip: ClipItem,
  onProgress?: ExportProgressCallback
): Promise<Blob> {
  const {
    canvas,
    sourceVideo,
    videoDurationSec,
    isPreCutSegment,
    audioSegment: rawAudioSegment,
    effectiveRenderDurationSec: renderDurationSec,
    cleanupSourceVideo,
  } = resources;
  const fps = 24;
  const totalFrames = Math.round(renderDurationSec * fps);

  // Path A: WebCodecs VideoEncoder (+ AudioEncoder) + mp4-muxer
  if (typeof VideoEncoder !== "undefined" && typeof VideoFrame !== "undefined") {
    // Prefer Constrained Baseline profiles with realtime latencyMode so WebCodecs
    // never emits B-frames with out-of-order PTS/DTS into mp4-muxer.
    const h264Candidates = [
      "avc1.42E01F",
      "avc1.42E028",
      "avc1.42E01E",
      "avc1.42001f",
      "avc1.4d0020",
      "avc1.4d001f",
      "avc1.640028",
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
          latencyMode: "realtime",
        };
        const support = await VideoEncoder.isConfigSupported(candidate);
        if (support.supported) {
          selectedVideoConfig = {
            ...(support.config || candidate),
            latencyMode: "realtime",
          };
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

      const preparedAudio = rawAudioSegment
        ? await prepareMuxableAudioTrack(rawAudioSegment)
        : null;

      if (rawAudioSegment && !preparedAudio) {
        cleanupSourceVideo();
        throw new Error(
          "Your browser WebCodecs AudioEncoder does not support AAC or Opus encoding for MP4 export."
        );
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
        ...(preparedAudio
          ? {
              audio: {
                codec: preparedAudio.muxerCodec,
                numberOfChannels: preparedAudio.encoderConfig.numberOfChannels,
                sampleRate: preparedAudio.encoderConfig.sampleRate,
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
      if (preparedAudio) {
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
        if (audioEncoder && preparedAudio) {
          audioEncoder.configure(preparedAudio.encoderConfig);
        }

        const frameDurationUs = Math.round(1_000_000 / fps);
        const motionHashes = new Set<string>();
        const sampleStride = Math.max(1, Math.floor(totalFrames / 12));

        // Encode video frames deterministically (frame-accurate seek when sourceVideo exists)
        for (let frame = 0; frame < totalFrames; frame++) {
          if (encoderError) throw encoderError;

          const progress = frame / totalFrames;
          const simulatedTime = progress * renderDurationSec;
          const pctSpan = audioEncoder ? 76 : 84;
          onProgress?.(12 + Math.round(progress * pctSpan), "Encoding video...");

          if (sourceVideo) {
            const maxVidTime = videoDurationSec > 0.1 ? videoDurationSec - 0.05 : targetStart + simulatedTime;
            const seekTarget = Math.min(Math.max(0, targetStart + simulatedTime), maxVidTime);
            await seekVideoTo(sourceVideo, seekTarget);
          }

          drawClipExportFrame(resources, clip, progress, simulatedTime);

          if (frame % sampleStride === 0 || frame === totalFrames - 1) {
            const sig = sampleCanvasFrameSignature(canvas);
            if (sig) motionHashes.add(sig);
          }

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

        if (totalFrames >= fps * 2 && motionHashes.size < 2) {
          throw new Error(
            "Export aborted: video frames appeared frozen on a single static frame. Please retry or attach a standard H.264 MP4."
          );
        }

        // Encode audio slice when available
        if (audioEncoder && preparedAudio) {
          onProgress?.(88, "Encoding audio...");
          const { audioBuffer, startSample, endSample } = preparedAudio.segment;
          const channels = preparedAudio.encoderConfig.numberOfChannels;
          const sampleRate = audioBuffer.sampleRate;
          const totalAudioSamples = endSample - startSample;
          const chunkFrames = preparedAudio.muxerCodec === "opus" ? 960 : 1024;
          let offset = 0;

          while (offset < totalAudioSamples) {
            if (encoderError) throw encoderError;
            const framesNow = Math.min(chunkFrames, totalAudioSamples - offset);
            const planarBuffer = new ArrayBuffer(framesNow * channels * 4);
            const planar = new Float32Array(planarBuffer);

            for (let ch = 0; ch < channels; ch++) {
              const chData = audioBuffer.getChannelData(
                Math.min(ch, Math.max(0, audioBuffer.numberOfChannels - 1))
              );
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
            onProgress?.(
              88 + Math.round((offset / totalAudioSamples) * 8),
              "Encoding audio..."
            );
          }
          await audioEncoder.flush();
        }

        await videoEncoder.flush();
        if (encoderError) throw encoderError;
        onProgress?.(97, "Finalizing MP4...");
        muxer.finalize();

        const mp4Blob = new Blob([target.buffer], { type: "video/mp4" });
        onProgress?.(98, "Validating export...");
        await validateExportedMp4Blob(mp4Blob, {
          requireAudio: Boolean(preparedAudio),
          minDurationSec: renderDurationSec,
        });
        onProgress?.(100, "Export ready");
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
    const recBlob = await recordCanvasWithMediaRecorder(
      resources,
      clip,
      mp4Mimes,
      "",
      "MP4 (H.264)",
      onProgress
    );
    onProgress?.(98, "Validating export...");
    await validateExportedMp4Blob(recBlob, {
      requireAudio: Boolean(rawAudioSegment),
      minDurationSec: renderDurationSec,
    });
    onProgress?.(100, "Export ready");
    return recBlob;
  }

  cleanupSourceVideo();
  throw new Error(
    "MP4 (H.264) export is not supported in this browser. Please open in Chrome, Edge, or Safari."
  );
}

export interface ExportDownloadSummary {
  usedSourceVideo: boolean;
  usedAudio: boolean;
  clipSourceError: string | null;
  voiceoverError: string | null;
}

async function renderMp4ClipWithSummary(
  clip: ClipItem,
  project: VideoProject,
  onProgress?: ExportProgressCallback,
  maxRenderSec = 65
): Promise<{ blob: Blob; summary: ExportDownloadSummary }> {
  const initialDurationSec = resolveFullClipDurationSec(clip, maxRenderSec);
  const resources = await prepareExportCanvasResources(
    clip,
    project,
    initialDurationSec,
    onProgress,
    { includeAudio: true, maxRenderSec, allowSceneFallback: false }
  );
  const usedSourceVideo = Boolean(resources.sourceVideo);
  const usedAudio = Boolean(resources.audioSegment);
  const clipSourceError = resources.clipSourceError;
  const voiceoverError = resources.voiceoverError;

  const blob = await encodePreparedMp4Resources(resources, clip, onProgress);
  return {
    blob,
    summary: { usedSourceVideo, usedAudio, clipSourceError, voiceoverError },
  };
}

export async function renderAndDownloadWebmClip(
  clip: ClipItem,
  project: VideoProject,
  onProgress?: ExportProgressCallback
): Promise<ExportDownloadSummary> {
  const maxRenderSec = 65;
  const renderDurationSec = resolveFullClipDurationSec(clip, maxRenderSec);
  const resources = await prepareExportCanvasResources(
    clip,
    project,
    renderDurationSec,
    onProgress,
    { includeAudio: true, maxRenderSec, allowSceneFallback: false }
  );
  const usedSourceVideo = Boolean(resources.sourceVideo);
  const usedAudio = Boolean(resources.audioSegment);
  const clipSourceError = resources.clipSourceError;
  const voiceoverError = resources.voiceoverError;
  const blob = await recordCanvasWithMediaRecorder(
    resources,
    clip,
    ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"],
    "video/webm",
    "WebM video",
    onProgress
  );
  triggerDownload(
    blob,
    `AI_Video_Clip_Generator_${slugify(clip.title)}-${clip.aspectRatio.replace(":", "x")}.webm`
  );
  return { usedSourceVideo, usedAudio, clipSourceError, voiceoverError };
}

export async function renderAndDownloadMp4Clip(
  clip: ClipItem,
  project: VideoProject,
  onProgress?: ExportProgressCallback
): Promise<ExportDownloadSummary> {
  const { blob, summary } = await renderMp4ClipWithSummary(clip, project, onProgress, 65);
  triggerDownload(
    blob,
    `AI_Video_Clip_Generator_${slugify(clip.title)}-${clip.aspectRatio.replace(":", "x")}.mp4`
  );
  return summary;
}

export async function renderAndDownloadOriginalCutMp4(
  clip: ClipItem,
  project: VideoProject,
  onProgress?: ExportProgressCallback
): Promise<{ hasAudioTrack: boolean }> {
  const startSec = Math.max(0, Number(clip.startTimeSec) || 0);
  const rawDur =
    Number(clip.durationSec) ||
    Math.max(0, (Number(clip.endTimeSec) || 0) - startSec) ||
    30;
  const durSec = Math.min(Math.max(2, Math.ceil(rawDur)), 120);
  const outFilename = `AI_Video_Clip_Generator_${slugify(clip.title)}-original.mp4`;

  onProgress?.(10, "Checking video...");

  if (project.localVideoUrl) {
    const localRes = await fetch(project.localVideoUrl);
    if (!localRes.ok) {
      throw new Error("Could not read attached local video file.");
    }
    const localBlob = await localRes.blob();
    if (localBlob.size <= 200 * 1024 * 1024) {
      onProgress?.(35, "Trimming video...");
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 90000);
      try {
        const trimRes = await fetch(
          apiUrl(`/api/video/trim-local?start=${startSec.toFixed(2)}&duration=${durSec}`),
          {
            method: "POST",
            headers: { "Content-Type": "application/octet-stream" },
            body: localBlob,
            signal: controller.signal,
          }
        );
        window.clearTimeout(timer);
        if (trimRes.ok) {
          onProgress?.(85, "Validating MP4...");
          const cutBlob = await trimRes.blob();
          const inspection = await validateExportedMp4Blob(cutBlob, {
            requireAudio: false,
            minDurationSec: Math.min(durSec, 2),
          });
          onProgress?.(100, "Export ready");
          triggerDownload(cutBlob, outFilename);
          return { hasAudioTrack: inspection.hasAudioTrack };
        } else {
          const errJson = await trimRes.json().catch(() => null);
          throw new Error(errJson?.error || "Server could not trim the uploaded video.");
        }
      } catch (err) {
        window.clearTimeout(timer);
        if (err instanceof Error && err.name === "AbortError") {
          throw new Error("Timed out while trimming the original video file.");
        }
        throw err;
      }
    }
    throw new Error(
      "Video file is larger than 200MB for direct server cut; use Captioned Video (.mp4) export instead."
    );
  }

  const isSyntheticDemoUrl =
    Boolean(project.isDemo) &&
    !project.youtubeId &&
    (!project.url || /watch\?v=demo_/i.test(project.url));

  if (isSyntheticDemoUrl || (!project.youtubeId && !project.url)) {
    throw new Error(
      "This demo clip has no downloadable original video stream. Click 'Attach original MP4' below to cut & download from a real video file."
    );
  }

  const remoteTarget = project.youtubeId
    ? `https://www.youtube.com/watch?v=${project.youtubeId}`
    : project.url!;

  onProgress?.(25, "Extracting clip...");
  const controller = new AbortController();
  const fetchTimer = window.setTimeout(() => controller.abort(), 75000);
  try {
    const clipSrcUrl = apiUrl(
      `/api/video/clip-source?url=${encodeURIComponent(remoteTarget)}&start=${Math.floor(
        startSec
      )}&duration=${durSec}`
    );
    const segRes = await fetch(clipSrcUrl, { signal: controller.signal });
    window.clearTimeout(fetchTimer);

    if (!segRes.ok) {
      const errJson = await segRes.json().catch(() => null);
      const rawErr = errJson?.error || `Original video cut failed (${segRes.status}).`;
      if (/not a bot|cookies|YOUTUBE_BOT_CHECK/i.test(rawErr)) {
        throw new Error(
          "YouTube blocked cloud server download on this video. Click 'Attach original MP4' below to cut & download all clips from your video file."
        );
      }
      throw new Error(rawErr);
    }

    onProgress?.(85, "Validating MP4...");
    const segBlob = await segRes.blob();
    const inspection = await validateExportedMp4Blob(segBlob, {
      requireAudio: false,
      minDurationSec: Math.min(durSec, 2),
    });
    onProgress?.(100, "Export ready");
    triggerDownload(segBlob, outFilename);
    return { hasAudioTrack: inspection.hasAudioTrack };
  } catch (err) {
    window.clearTimeout(fetchTimer);
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("Timed out extracting original video segment.");
    }
    throw err;
  }
}

export async function downloadCoverPng(
  clip: ClipItem,
  project: VideoProject
): Promise<void> {
  const resources = await prepareExportCanvasResources(clip, project, 5, undefined, {
    includeAudio: false,
    maxRenderSec: 5,
    allowSceneFallback: true,
  });
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
      `AI_Video_Clip_Generator_${slugify(clip.title)}-${clip.aspectRatio.replace(":", "x")}-cover.png`
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
      .slice(0, 48) || "clip"
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
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
