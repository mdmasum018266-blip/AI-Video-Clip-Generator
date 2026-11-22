import { User } from "firebase/auth";
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { db, handleFirestoreError, OperationType } from "../firebase";
import {
  BrandTemplate,
  ClipItem,
  ScheduledPost,
  UsageEntry,
  VideoProject,
} from "../types";

const FALLBACK_THUMBNAIL = "/src/assets/images/demo_creator_editing_1795261138677.jpg";

export function sanitizeDocId(rawId: string, prefix = "doc"): string {
  const cleaned = String(rawId || "")
    .replace(/[^a-zA-Z0-9_\-]/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 120);
  return cleaned || `${prefix}-${Date.now()}`;
}

function clampStr(val: unknown, maxLen: number, fallback = ""): string {
  const str = String(val ?? fallback).trim();
  return str.slice(0, maxLen) || fallback.slice(0, maxLen);
}

function sanitizeThumbnail(url: string | undefined): string {
  if (!url || url.startsWith("data:") || url.startsWith("blob:") || url.length > 1950) {
    return FALLBACK_THUMBNAIL;
  }
  return url;
}

function stripUndefinedDeep<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => stripUndefinedDeep(item)) as unknown as T;
  }
  if (
    value !== null &&
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype
  ) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v !== undefined) {
        out[k] = stripUndefinedDeep(v);
      }
    }
    return out as T;
  }
  return value;
}

function sanitizeClips(clips: ClipItem[]): ClipItem[] {
  return clips.slice(0, 15).map((c) => {
    const cleanClip: ClipItem = {
      id: sanitizeDocId(c.id, "clip"),
      projectId: sanitizeDocId(c.projectId, "proj"),
      rank: Number(c.rank) || 1,
      title: clampStr(c.title, 180, "Clip"),
      hookTitle: clampStr(c.hookTitle, 120, "WATCH THIS"),
      startTimeSec: Number(c.startTimeSec) || 0,
      endTimeSec: Number(c.endTimeSec) || 45,
      durationSec: Number(c.durationSec) || 45,
      viralityScore: Number(c.viralityScore) || 85,
      hookStrength: Number(c.hookStrength) || 85,
      pacingScore: Number(c.pacingScore) || 85,
      whyViral: clampStr(c.whyViral, 600, "Strong hook."),
      resolution: c.resolution === "720p" ? "720p" : "1080p",
      aspectRatio: c.aspectRatio || "9:16",
      captionStyle: c.captionStyle || "classic",
      showAutoHook: Boolean(c.showAutoHook),
      focalPointX: Number.isFinite(Number(c.focalPointX)) ? Number(c.focalPointX) : 50,
      zoomScale: Number.isFinite(Number(c.zoomScale)) ? Number(c.zoomScale) : 1.1,
      splitScreen: Boolean(c.splitScreen),
      language: clampStr(c.language, 60, "English"),
      isFavorite: Boolean(c.isFavorite),
      transcript: Array.isArray(c.transcript)
        ? c.transcript.slice(0, 20).map((cue, idx) => ({
            id: clampStr(cue.id || `cue-${idx}`, 80),
            startOffsetSec: Number(cue.startOffsetSec) || 0,
            endOffsetSec: Number(cue.endOffsetSec) || 5,
            text: clampStr(cue.text, 500),
            emphasisWords: Array.isArray(cue.emphasisWords)
              ? cue.emphasisWords.slice(0, 6).map((w) => clampStr(w, 40))
              : [],
          }))
        : [],
    };
    if (c.splitScreenBgId) {
      cleanClip.splitScreenBgId = clampStr(c.splitScreenBgId, 64);
    }
    if (c.videoCategory) {
      cleanClip.videoCategory = clampStr(c.videoCategory, 80);
    }
    if (Array.isArray(c.hashtags) && c.hashtags.length > 0) {
      cleanClip.hashtags = c.hashtags.slice(0, 10).map((h) => clampStr(h, 40)).filter(Boolean);
    }
    return cleanClip;
  });
}

export async function ensureUserProfile(
  user: User,
  defaults: { autoUploadEnabled: boolean; autoQueueTopClip: boolean }
): Promise<{ autoUploadEnabled: boolean; autoQueueTopClip: boolean }> {
  const userPath = `users/${user.uid}`;
  const ref = doc(db, "users", user.uid);
  try {
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      await setDoc(ref, {
        uid: user.uid,
        email: clampStr(user.email, 256, "user@scalereach.app"),
        displayName: clampStr(user.displayName || user.email?.split("@")[0], 120, "Creator"),
        ...(user.photoURL && user.photoURL.length <= 500
          ? { photoURL: user.photoURL }
          : {}),
        autoUploadEnabled: defaults.autoUploadEnabled,
        autoQueueTopClip: defaults.autoQueueTopClip,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      return defaults;
    }
    const existing = snap.data();
    await updateDoc(ref, {
      displayName: clampStr(user.displayName || existing.displayName, 120, "Creator"),
      email: clampStr(user.email || existing.email, 256, "user@scalereach.app"),
      ...(user.photoURL && user.photoURL.length <= 500
        ? { photoURL: user.photoURL }
        : {}),
      updatedAt: serverTimestamp(),
    });
    return {
      autoUploadEnabled:
        typeof existing.autoUploadEnabled === "boolean"
          ? existing.autoUploadEnabled
          : defaults.autoUploadEnabled,
      autoQueueTopClip:
        typeof existing.autoQueueTopClip === "boolean"
          ? existing.autoQueueTopClip
          : defaults.autoQueueTopClip,
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, userPath);
  }
}

export async function updateUserPreferencesInCloud(
  uid: string,
  prefs: { autoUploadEnabled: boolean; autoQueueTopClip: boolean }
): Promise<void> {
  const userPath = `users/${uid}`;
  try {
    await updateDoc(doc(db, "users", uid), {
      autoUploadEnabled: Boolean(prefs.autoUploadEnabled),
      autoQueueTopClip: Boolean(prefs.autoQueueTopClip),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, userPath);
  }
}

export async function saveProjectToCloud(
  uid: string,
  project: VideoProject,
  isNew: boolean
): Promise<void> {
  const safeId = sanitizeDocId(project.id, "proj");
  const path = `users/${uid}/projects/${safeId}`;
  const ref = doc(db, "users", uid, "projects", safeId);

  const basePayload = {
    id: safeId,
    ownerId: uid,
    title: clampStr(project.title, 200, "Untitled Project"),
    channel: clampStr(project.channel, 120, "Creator"),
    sourceType: project.sourceType,
    ...(project.url && project.url.length <= 1000 ? { url: project.url } : {}),
    ...(project.youtubeId && project.youtubeId.length <= 64
      ? { youtubeId: project.youtubeId }
      : {}),
    thumbnailUrl: sanitizeThumbnail(project.thumbnailUrl),
    durationSec: Math.min(86400, Math.max(0, Number(project.durationSec) || 0)),
    createdAtLabel: clampStr(project.createdAt, 64, "Today"),
    clipType: clampStr(project.clipType, 80, "Viral Clips"),
    language: clampStr(project.language, 60, "English"),
    aspectRatio: project.aspectRatio,
    captionStyle: clampStr(project.captionStyle, 40, "classic"),
    autoHook: Boolean(project.autoHook),
    splitScreen: Boolean(project.splitScreen),
    ...(project.splitScreenBgId && project.splitScreenBgId.length <= 64
      ? { splitScreenBgId: project.splitScreenBgId }
      : {}),
    ...(typeof project.isDemo === "boolean" ? { isDemo: project.isDemo } : {}),
    clips: sanitizeClips(project.clips),
  };

  let op = isNew ? OperationType.CREATE : OperationType.UPDATE;
  try {
    let shouldCreate = isNew;
    if (!shouldCreate) {
      const snap = await getDoc(ref);
      shouldCreate = !snap.exists();
    }
    op = shouldCreate ? OperationType.CREATE : OperationType.UPDATE;

    if (shouldCreate) {
      await setDoc(
        ref,
        stripUndefinedDeep({
          ...basePayload,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );
    } else {
      await updateDoc(
        ref,
        stripUndefinedDeep({
          title: basePayload.title,
          captionStyle: basePayload.captionStyle,
          aspectRatio: basePayload.aspectRatio,
          autoHook: basePayload.autoHook,
          splitScreen: basePayload.splitScreen,
          ...(basePayload.splitScreenBgId
            ? { splitScreenBgId: basePayload.splitScreenBgId }
            : {}),
          clips: basePayload.clips,
          updatedAt: serverTimestamp(),
        })
      );
    }
  } catch (error) {
    handleFirestoreError(error, op, path);
  }
}

export async function saveBrandTemplateToCloud(
  uid: string,
  tpl: BrandTemplate,
  isNew: boolean
): Promise<void> {
  const safeId = sanitizeDocId(tpl.id, "bt");
  const path = `users/${uid}/brandTemplates/${safeId}`;
  const ref = doc(db, "users", uid, "brandTemplates", safeId);

  const payload = {
    id: safeId,
    ownerId: uid,
    name: clampStr(tpl.name, 100, "Brand Preset"),
    captionStyle: clampStr(tpl.captionStyle, 40, "classic"),
    aspectRatio: tpl.aspectRatio,
    autoHook: Boolean(tpl.autoHook),
    accentHex: clampStr(tpl.accentHex, 16, "#3B82F6"),
    watermarkHandle: clampStr(tpl.watermarkHandle, 60, "@creator"),
    splitScreen: Boolean(tpl.splitScreen),
  };

  let op = isNew ? OperationType.CREATE : OperationType.UPDATE;
  try {
    let shouldCreate = isNew;
    if (!shouldCreate) {
      const snap = await getDoc(ref);
      shouldCreate = !snap.exists();
    }
    op = shouldCreate ? OperationType.CREATE : OperationType.UPDATE;

    if (shouldCreate) {
      await setDoc(ref, {
        ...payload,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        name: payload.name,
        captionStyle: payload.captionStyle,
        aspectRatio: payload.aspectRatio,
        autoHook: payload.autoHook,
        accentHex: payload.accentHex,
        watermarkHandle: payload.watermarkHandle,
        splitScreen: payload.splitScreen,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, op, path);
  }
}

export async function deleteBrandTemplateFromCloud(
  uid: string,
  templateId: string
): Promise<void> {
  const safeId = sanitizeDocId(templateId, "bt");
  const path = `users/${uid}/brandTemplates/${safeId}`;
  try {
    await deleteDoc(doc(db, "users", uid, "brandTemplates", safeId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function saveScheduledPostToCloud(
  uid: string,
  post: ScheduledPost,
  isNew: boolean
): Promise<void> {
  const safeId = sanitizeDocId(post.id, "post");
  const path = `users/${uid}/scheduledPosts/${safeId}`;
  const ref = doc(db, "users", uid, "scheduledPosts", safeId);

  const payload = {
    id: safeId,
    ownerId: uid,
    clipId: clampStr(post.clipId, 128, "clip"),
    clipTitle: clampStr(post.clipTitle, 200, "Clip"),
    projectTitle: clampStr(post.projectTitle, 200, "Project"),
    thumbnailUrl: sanitizeThumbnail(post.thumbnailUrl),
    platform: post.platform,
    scheduledFor: clampStr(post.scheduledFor, 80, "Scheduled"),
    captionText: clampStr(post.captionText, 2200, ""),
    status: post.status,
  };

  let op = isNew ? OperationType.CREATE : OperationType.UPDATE;
  try {
    let shouldCreate = isNew;
    if (!shouldCreate) {
      const snap = await getDoc(ref);
      shouldCreate = !snap.exists();
    }
    op = shouldCreate ? OperationType.CREATE : OperationType.UPDATE;

    if (shouldCreate) {
      await setDoc(ref, {
        ...payload,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, {
        scheduledFor: payload.scheduledFor,
        captionText: payload.captionText,
        status: payload.status,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, op, path);
  }
}

export async function deleteScheduledPostFromCloud(
  uid: string,
  postId: string
): Promise<void> {
  const safeId = sanitizeDocId(postId, "post");
  const path = `users/${uid}/scheduledPosts/${safeId}`;
  try {
    await deleteDoc(doc(db, "users", uid, "scheduledPosts", safeId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function saveUsageEntryToCloud(
  uid: string,
  entry: UsageEntry
): Promise<void> {
  const safeId = sanitizeDocId(entry.id, "u");
  const path = `users/${uid}/usageHistory/${safeId}`;
  try {
    await setDoc(doc(db, "users", uid, "usageHistory", safeId), {
      id: safeId,
      ownerId: uid,
      projectTitle: clampStr(entry.projectTitle, 200, "Project"),
      dateLabel: clampStr(entry.date, 64, "Today"),
      minutesProcessed: Math.min(10000, Math.max(0, Number(entry.minutesProcessed) || 0)),
      clipsGenerated: Math.min(100, Math.max(0, Number(entry.clipsGenerated) || 0)),
      sourceType: clampStr(entry.sourceType, 40, "YouTube"),
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function seedCloudWorkspaceIfEmpty(
  uid: string,
  initialProjects: VideoProject[],
  initialTemplates: BrandTemplate[],
  initialUsage: UsageEntry[]
): Promise<void> {
  const projectsPath = `users/${uid}/projects`;
  let existingProjects;
  let existingTemplates;
  let existingUsage;
  try {
    existingProjects = await getDocs(collection(db, "users", uid, "projects"));
    existingTemplates = await getDocs(collection(db, "users", uid, "brandTemplates"));
    existingUsage = await getDocs(collection(db, "users", uid, "usageHistory"));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, projectsPath);
  }

  if (existingProjects.empty) {
    for (const proj of initialProjects.slice(0, 6)) {
      await saveProjectToCloud(uid, proj, true);
    }
  }
  if (existingTemplates.empty) {
    for (const tpl of initialTemplates.slice(0, 6)) {
      await saveBrandTemplateToCloud(uid, tpl, true);
    }
  }
  if (existingUsage.empty) {
    for (const item of initialUsage.slice(0, 6)) {
      await saveUsageEntryToCloud(uid, item);
    }
  }
}
