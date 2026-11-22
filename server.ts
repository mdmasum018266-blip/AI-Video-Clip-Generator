import "dotenv/config";
import crypto from "crypto";
import express, { Request, Response } from "express";
import path from "path";
import { fileURLToPath } from "url";
import { createServer as createViteServer } from "vite";
import { GenerateContentParameters, GoogleGenAI, ThinkingLevel, Type } from "@google/genai";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);

type SocialPlatformKey = "tiktok" | "instagram" | "youtube" | "linkedin" | "facebook";

interface ConnectedTokenRecord {
  accessToken: string;
  refreshToken?: string;
  accountName: string;
  accountHandle: string;
  connectedAt: string;
  platformUserId?: string;
  hasPublishablePage?: boolean;
}

interface SessionData {
  tokens: Partial<Record<SocialPlatformKey, ConnectedTokenRecord>>;
}

const sessions = new Map<string, SessionData>();
const oauthStates = new Map<
  string,
  { platform: SocialPlatformKey; sessionId: string; redirectUri: string; createdAt: number }
>();

const PLATFORM_CONFIG: Record<
  SocialPlatformKey,
  {
    displayName: "TikTok" | "Instagram Reels" | "YouTube Shorts" | "LinkedIn" | "Facebook";
    clientKeyEnv: string;
    clientSecretEnv: string;
    developerConsoleUrl: string;
  }
> = {
  tiktok: {
    displayName: "TikTok",
    clientKeyEnv: "TIKTOK_CLIENT_KEY",
    clientSecretEnv: "TIKTOK_CLIENT_SECRET",
    developerConsoleUrl: "https://developers.tiktok.com/apps/",
  },
  instagram: {
    displayName: "Instagram Reels",
    clientKeyEnv: "INSTAGRAM_CLIENT_ID",
    clientSecretEnv: "INSTAGRAM_CLIENT_SECRET",
    developerConsoleUrl: "https://developers.facebook.com/apps/",
  },
  youtube: {
    displayName: "YouTube Shorts",
    clientKeyEnv: "YOUTUBE_CLIENT_ID",
    clientSecretEnv: "YOUTUBE_CLIENT_SECRET",
    developerConsoleUrl: "https://console.cloud.google.com/apis/credentials",
  },
  linkedin: {
    displayName: "LinkedIn",
    clientKeyEnv: "LINKEDIN_CLIENT_ID",
    clientSecretEnv: "LINKEDIN_CLIENT_SECRET",
    developerConsoleUrl: "https://www.linkedin.com/developers/apps",
  },
  facebook: {
    displayName: "Facebook",
    clientKeyEnv: "FACEBOOK_CLIENT_ID",
    clientSecretEnv: "FACEBOOK_CLIENT_SECRET",
    developerConsoleUrl: "https://developers.facebook.com/apps/",
  },
};

function isSocialPlatform(val: string): val is SocialPlatformKey {
  return (
    val === "tiktok" ||
    val === "instagram" ||
    val === "youtube" ||
    val === "linkedin" ||
    val === "facebook"
  );
}

function getAppBaseUrl(req?: Request): string {
  const envUrl = process.env.APP_URL?.trim();
  if (envUrl && envUrl !== "MY_APP_URL" && /^https?:\/\//i.test(envUrl)) {
    return envUrl.replace(/\/+$/, "");
  }
  if (req) {
    const rawHost = req.headers["x-forwarded-host"] || req.headers.host;
    const host = Array.isArray(rawHost) ? rawHost[0] : rawHost?.split(",")[0]?.trim();
    if (host && !host.startsWith("localhost") && !host.startsWith("127.0.0.1")) {
      const rawProto = req.headers["x-forwarded-proto"];
      const proto =
        (Array.isArray(rawProto) ? rawProto[0] : rawProto?.split(",")[0]?.trim()) || "https";
      return `${proto}://${host}`;
    }
    if (host) {
      return `http://${host}`;
    }
  }
  return `http://localhost:${PORT}`;
}

function parseCookies(req: Request): Record<string, string> {
  const header = req.headers.cookie || "";
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx > 0) {
      const k = part.slice(0, idx).trim();
      const v = part.slice(idx + 1).trim();
      out[k] = decodeURIComponent(v);
    }
  }
  return out;
}

function getOrCreateSession(req: Request, res: Response): { sessionId: string; data: SessionData } {
  const cookies = parseCookies(req);
  let sid = cookies.sr_sid;
  if (!sid || !sessions.has(sid)) {
    sid = crypto.randomBytes(24).toString("hex");
    sessions.set(sid, { tokens: {} });
    res.setHeader(
      "Set-Cookie",
      `sr_sid=${encodeURIComponent(sid)}; Path=/; HttpOnly; Secure; SameSite=None; Partitioned; Max-Age=604800`
    );
  }
  return { sessionId: sid, data: sessions.get(sid)! };
}

function verifyMutationOrigin(req: Request): boolean {
  if (req.headers["x-requested-with"] === "ScaleReach") return true;
  const origin = req.headers.origin;
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  if (!origin || !host) return false;
  try {
    const originHost = new URL(origin).host;
    return originHost === String(host).split(",")[0].trim();
  } catch {
    return false;
  }
}

function escapeHtmlText(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is not configured. Please add your Gemini API key in Settings > Secrets."
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

function parseReadableError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  try {
    const parsed = JSON.parse(raw);
    if (parsed?.error?.message) return String(parsed.error.message);
  } catch {
    // Not raw JSON
  }
  return raw;
}

async function callGeminiWithFallback(
  ai: GoogleGenAI,
  params: Omit<GenerateContentParameters, "model">,
  primaryModel = "gemini-4-hydrogen"
) {
  const modelsToTry = [primaryModel, "gemini-3.1-flash-lite"];
  let lastError: unknown;

  for (const model of modelsToTry) {
    const isFlash4 = model === "gemini-4-hydrogen";
    const configWithThinking = isFlash4
      ? {
          ...params.config,
          thinkingConfig: params.config?.thinkingConfig ?? {
            thinkingLevel: ThinkingLevel.LOW,
          },
        }
      : { ...params.config };

    if (!isFlash4 && configWithThinking.thinkingConfig) {
      delete configWithThinking.thinkingConfig;
    }

    try {
      return await ai.models.generateContent({
        ...params,
        model,
        config: configWithThinking,
      });
    } catch (err) {
      lastError = err;
      const msg = err instanceof Error ? err.message : String(err);
      const isTransient =
        msg.includes("503") ||
        msg.includes("UNAVAILABLE") ||
        msg.includes("429") ||
        msg.includes("RESOURCE_EXHAUSTED") ||
        msg.includes("high demand");

      if (!isTransient) {
        throw err;
      }
      await new Promise((r) => setTimeout(r, 350));
    }
  }

  throw lastError;
}

function extractYouTubeId(rawUrl: string): string | null {
  try {
    const normalized = /^https?:\/\//i.test(rawUrl.trim())
      ? rawUrl.trim()
      : `https://${rawUrl.trim()}`;
    const parsed = new URL(normalized);
    const host = parsed.hostname.replace(/^www\./, "").toLowerCase();
    if (host === "youtu.be") {
      const id = parsed.pathname.split("/").filter(Boolean)[0];
      return id || null;
    }
    if (host.includes("youtube.com")) {
      const v = parsed.searchParams.get("v");
      if (v) return v;
      const parts = parsed.pathname.split("/").filter(Boolean);
      if (parts[0] === "shorts" || parts[0] === "live" || parts[0] === "embed") {
        return parts[1] || null;
      }
    }
  } catch {
    // Ignore invalid URL syntax
  }
  return null;
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: "32mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  /* ------------------------------------------------------------------------ */
  /* SOCIAL OAUTH & AUTO-UPLOAD ROUTES                                        */
  /* ------------------------------------------------------------------------ */
  app.get("/api/social/accounts", (req, res) => {
    const { data } = getOrCreateSession(req, res);
    const baseUrl = getAppBaseUrl(req);

    const accounts = (Object.keys(PLATFORM_CONFIG) as SocialPlatformKey[]).map((key) => {
      const cfg = PLATFORM_CONFIG[key];
      const clientId = process.env[cfg.clientKeyEnv];
      const clientSecret = process.env[cfg.clientSecretEnv];
      const tokenRecord = data.tokens[key];

      return {
        platform: key,
        displayName: cfg.displayName,
        connected: Boolean(tokenRecord?.accessToken),
        configured: Boolean(clientId && clientSecret),
        accountName: tokenRecord?.accountName,
        accountHandle: tokenRecord?.accountHandle,
        callbackUrl: `${baseUrl}/api/social/callback/${key}`,
        requiredEnvVars: [cfg.clientKeyEnv, cfg.clientSecretEnv],
        envStatus: {
          keyConfigured: Boolean(clientId),
          secretConfigured: Boolean(clientSecret),
        },
        developerConsoleUrl: cfg.developerConsoleUrl,
      };
    });

    res.json({ accounts });
  });

  app.get("/api/social/auth/:platform", (req, res) => {
    const platformParam = String(req.params.platform || "").toLowerCase();
    if (!isSocialPlatform(platformParam)) {
      res.status(400).json({ error: "Unsupported social platform." });
      return;
    }

    const { sessionId } = getOrCreateSession(req, res);
    const cfg = PLATFORM_CONFIG[platformParam];
    const clientId = process.env[cfg.clientKeyEnv];
    const clientSecret = process.env[cfg.clientSecretEnv];
    const redirectUri = `${getAppBaseUrl(req)}/api/social/callback/${platformParam}`;

    if (!clientId || !clientSecret) {
      res.json({
        configured: false,
        platform: platformParam,
        displayName: cfg.displayName,
        callbackUrl: redirectUri,
        requiredEnvVars: [cfg.clientKeyEnv, cfg.clientSecretEnv],
        developerConsoleUrl: cfg.developerConsoleUrl,
      });
      return;
    }

    const now = Date.now();
    for (const [k, v] of oauthStates.entries()) {
      if (now - v.createdAt > 10 * 60 * 1000) {
        oauthStates.delete(k);
      }
    }

    const state = crypto.randomBytes(18).toString("hex");
    oauthStates.set(state, {
      platform: platformParam,
      sessionId,
      redirectUri,
      createdAt: now,
    });

    let authUrl = "";
    if (platformParam === "tiktok") {
      const params = new URLSearchParams({
        client_key: clientId,
        scope: "user.info.basic,video.upload,video.publish",
        response_type: "code",
        redirect_uri: redirectUri,
        state,
      });
      authUrl = `https://www.tiktok.com/v2/auth/authorize/?${params.toString()}`;
    } else if (platformParam === "instagram") {
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        scope: "instagram_basic,instagram_content_publish,pages_show_list",
        response_type: "code",
        state,
      });
      authUrl = `https://www.facebook.com/v19.0/dialog/oauth?${params.toString()}`;
    } else if (platformParam === "youtube") {
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope:
          "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly",
        access_type: "offline",
        prompt: "consent",
        state,
      });
      authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    } else if (platformParam === "facebook") {
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        scope: "public_profile,pages_show_list,pages_manage_posts,publish_video",
        response_type: "code",
        state,
      });
      authUrl = `https://www.facebook.com/v19.0/dialog/oauth?${params.toString()}`;
    } else {
      const params = new URLSearchParams({
        response_type: "code",
        client_id: clientId,
        redirect_uri: redirectUri,
        scope: "openid profile w_member_social",
        state,
      });
      authUrl = `https://www.linkedin.com/oauth/v2/authorization?${params.toString()}`;
    }

    res.json({ configured: true, url: authUrl });
  });

  const handleOAuthCallback = async (req: Request, res: Response) => {
    const platformParam = String(req.params.platform || "").toLowerCase();
    const code = String(req.query.code || "");
    const state = String(req.query.state || "");
    const errorDesc = String(req.query.error_description || req.query.error || "");

    if (errorDesc) {
      const safeErrorJson = JSON.stringify(errorDesc).replace(/</g, "\\u003c");
      res.status(400).send(`
        <html><body style="background:#0a0a0c;color:#f4f4f6;font-family:sans-serif;padding:24px;">
          <h3>Connection cancelled</h3>
          <p>${escapeHtmlText(errorDesc)}</p>
          <script>if(window.opener){window.opener.postMessage({type:'OAUTH_AUTH_ERROR',error:${safeErrorJson}},'*');setTimeout(()=>window.close(),1200);}</script>
        </body></html>
      `);
      return;
    }

    if (!isSocialPlatform(platformParam) || !code || !state) {
      res.status(400).send("Invalid OAuth callback parameters.");
      return;
    }

    const stateRecord = oauthStates.get(state);
    oauthStates.delete(state);
    if (!stateRecord || stateRecord.platform !== platformParam) {
      res.status(400).send("Invalid or expired OAuth state.");
      return;
    }

    const session = sessions.get(stateRecord.sessionId);
    if (!session) {
      res.status(400).send("Session expired. Please retry connecting from the app.");
      return;
    }

    const cfg = PLATFORM_CONFIG[platformParam];
    const clientId = process.env[cfg.clientKeyEnv]!;
    const clientSecret = process.env[cfg.clientSecretEnv]!;
    const redirectUri =
      stateRecord.redirectUri || `${getAppBaseUrl(req)}/api/social/callback/${platformParam}`;

    try {
      let tokenRecord: ConnectedTokenRecord;

      if (platformParam === "tiktok") {
        const tokenRes = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_key: clientId,
            client_secret: clientSecret,
            code,
            grant_type: "authorization_code",
            redirect_uri: redirectUri,
          }),
        });
        const tokenJson = (await tokenRes.json()) as {
          access_token?: string;
          refresh_token?: string;
          open_id?: string;
          error_description?: string;
        };
        if (!tokenRes.ok || !tokenJson.access_token) {
          throw new Error(tokenJson.error_description || "TikTok token exchange failed");
        }
        let accountName = "TikTok Creator";
        let accountHandle = "@tiktok";
        try {
          const profRes = await fetch(
            "https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,username",
            { headers: { Authorization: `Bearer ${tokenJson.access_token}` } }
          );
          const prof = (await profRes.json()) as {
            data?: { user?: { display_name?: string; username?: string } };
          };
          if (prof.data?.user?.display_name) accountName = prof.data.user.display_name;
          if (prof.data?.user?.username) accountHandle = `@${prof.data.user.username}`;
        } catch {
          // Optional profile fetch
        }
        tokenRecord = {
          accessToken: tokenJson.access_token,
          refreshToken: tokenJson.refresh_token,
          accountName,
          accountHandle,
          platformUserId: tokenJson.open_id,
          connectedAt: new Date().toISOString(),
        };
      } else if (platformParam === "instagram") {
        const tokenRes = await fetch(
          `https://graph.facebook.com/v19.0/oauth/access_token?${new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
            code,
          })}`
        );
        const tokenJson = (await tokenRes.json()) as {
          access_token?: string;
          error?: { message?: string };
        };
        if (!tokenRes.ok || !tokenJson.access_token) {
          throw new Error(tokenJson.error?.message || "Instagram token exchange failed");
        }
        let accountName = "Instagram Creator";
        let accountHandle = "@instagram";
        let igUserId: string | undefined;
        try {
          const pagesRes = await fetch(
            `https://graph.facebook.com/v19.0/me/accounts?fields=name,instagram_business_account{id,username,name}&access_token=${encodeURIComponent(
              tokenJson.access_token
            )}`
          );
          const pages = (await pagesRes.json()) as {
            data?: Array<{
              instagram_business_account?: { id?: string; username?: string; name?: string };
            }>;
          };
          const ig = pages.data?.find((p) => p.instagram_business_account)?.instagram_business_account;
          if (ig) {
            igUserId = ig.id;
            if (ig.name) accountName = ig.name;
            if (ig.username) accountHandle = `@${ig.username}`;
          }
        } catch {
          // Optional profile lookup
        }
        tokenRecord = {
          accessToken: tokenJson.access_token,
          accountName,
          accountHandle,
          platformUserId: igUserId,
          connectedAt: new Date().toISOString(),
        };
      } else if (platformParam === "youtube") {
        const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            code,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
            grant_type: "authorization_code",
          }),
        });
        const tokenJson = (await tokenRes.json()) as {
          access_token?: string;
          refresh_token?: string;
          error_description?: string;
        };
        if (!tokenRes.ok || !tokenJson.access_token) {
          throw new Error(tokenJson.error_description || "YouTube token exchange failed");
        }
        let accountName = "YouTube Channel";
        let accountHandle = "@youtube";
        try {
          const chRes = await fetch(
            "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true",
            { headers: { Authorization: `Bearer ${tokenJson.access_token}` } }
          );
          const chData = (await chRes.json()) as {
            items?: Array<{ snippet?: { title?: string; customUrl?: string } }>;
          };
          const snippet = chData.items?.[0]?.snippet;
          if (snippet?.title) accountName = snippet.title;
          if (snippet?.customUrl) accountHandle = snippet.customUrl;
        } catch {
          // Optional profile lookup
        }
        tokenRecord = {
          accessToken: tokenJson.access_token,
          refreshToken: tokenJson.refresh_token,
          accountName,
          accountHandle,
          connectedAt: new Date().toISOString(),
        };
      } else if (platformParam === "facebook") {
        const tokenRes = await fetch(
          `https://graph.facebook.com/v19.0/oauth/access_token?${new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
            code,
          })}`
        );
        const tokenJson = (await tokenRes.json()) as {
          access_token?: string;
          error?: { message?: string };
        };
        if (!tokenRes.ok || !tokenJson.access_token) {
          throw new Error(tokenJson.error?.message || "Facebook token exchange failed");
        }
        let accessToken = tokenJson.access_token;
        let accountName = "Facebook Creator";
        let accountHandle = "@facebook";
        let pageId: string | undefined;
        let hasPublishablePage = false;

        try {
          const pagesRes = await fetch(
            `https://graph.facebook.com/v19.0/me/accounts?fields=id,name,access_token&access_token=${encodeURIComponent(
              tokenJson.access_token
            )}`
          );
          const pagesData = (await pagesRes.json()) as {
            data?: Array<{ id?: string; name?: string; access_token?: string }>;
          };
          const managedPage = pagesData.data?.find((p) => p.id && p.access_token);
          if (managedPage?.id && managedPage.access_token) {
            accessToken = managedPage.access_token;
            pageId = managedPage.id;
            hasPublishablePage = true;
            if (managedPage.name) {
              accountName = managedPage.name;
              accountHandle = `@${managedPage.name.toLowerCase().replace(/\s+/g, "")}`;
            }
          } else {
            const meRes = await fetch(
              `https://graph.facebook.com/v19.0/me?fields=id,name&access_token=${encodeURIComponent(
                tokenJson.access_token
              )}`
            );
            const me = (await meRes.json()) as { id?: string; name?: string };
            if (me.name) {
              accountName = me.name;
              accountHandle = `@${me.name.toLowerCase().replace(/\s+/g, "")}`;
            }
            if (me.id) pageId = me.id;
          }
        } catch {
          // Optional profile lookup
        }
        tokenRecord = {
          accessToken,
          accountName,
          accountHandle,
          platformUserId: pageId,
          hasPublishablePage,
          connectedAt: new Date().toISOString(),
        };
      } else {
        const tokenRes = await fetch("https://www.linkedin.com/oauth/v2/accessToken", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            code,
            redirect_uri: redirectUri,
            client_id: clientId,
            client_secret: clientSecret,
          }),
        });
        const tokenJson = (await tokenRes.json()) as {
          access_token?: string;
          error_description?: string;
        };
        if (!tokenRes.ok || !tokenJson.access_token) {
          throw new Error(tokenJson.error_description || "LinkedIn token exchange failed");
        }
        let accountName = "LinkedIn Member";
        let memberSub: string | undefined;
        try {
          const meRes = await fetch("https://api.linkedin.com/v2/userinfo", {
            headers: { Authorization: `Bearer ${tokenJson.access_token}` },
          });
          const me = (await meRes.json()) as { sub?: string; name?: string };
          if (me.name) accountName = me.name;
          if (me.sub) memberSub = me.sub;
        } catch {
          // Optional profile lookup
        }
        tokenRecord = {
          accessToken: tokenJson.access_token,
          accountName,
          accountHandle: accountName,
          platformUserId: memberSub,
          connectedAt: new Date().toISOString(),
        };
      }

      session.tokens[platformParam] = tokenRecord;

      const safePlatformJson = JSON.stringify(platformParam).replace(/</g, "\\u003c");
      res.send(`
        <html>
          <body style="background:#0a0a0c;color:#f4f4f6;font-family:sans-serif;padding:24px;">
            <script>
              if (window.opener) {
                window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS', platform: ${safePlatformJson} }, '*');
                window.close();
              } else {
                window.location.href = '/';
              }
            </script>
            <p>${escapeHtmlText(cfg.displayName)} connected. This window will close automatically.</p>
          </body>
        </html>
      `);
    } catch (err) {
      const msg = parseReadableError(err);
      const safeMsgJson = JSON.stringify(msg).replace(/</g, "\\u003c");
      res.status(500).send(`
        <html>
          <body style="background:#0a0a0c;color:#f4f4f6;font-family:sans-serif;padding:24px;">
            <h3>Connection failed</h3>
            <p>${escapeHtmlText(msg)}</p>
            <script>if(window.opener){window.opener.postMessage({type:'OAUTH_AUTH_ERROR',error:${safeMsgJson}},'*');}</script>
          </body>
        </html>
      `);
    }
  };

  app.get(["/api/social/callback/:platform", "/api/social/callback/:platform/"], handleOAuthCallback);

  app.post("/api/social/disconnect/:platform", (req, res) => {
    if (!verifyMutationOrigin(req)) {
      res.status(403).json({ error: "Invalid request origin." });
      return;
    }
    const platformParam = String(req.params.platform || "").toLowerCase();
    if (!isSocialPlatform(platformParam)) {
      res.status(400).json({ error: "Unsupported social platform." });
      return;
    }
    const { data } = getOrCreateSession(req, res);
    delete data.tokens[platformParam];
    res.json({ ok: true });
  });

  app.post("/api/social/publish", async (req, res) => {
    if (!verifyMutationOrigin(req)) {
      res.status(403).json({ error: "Invalid request origin." });
      return;
    }

    const { platform, title, captionText, videoBase64, mimeType } = req.body as {
      platform?: string;
      title?: string;
      captionText?: string;
      videoBase64?: string;
      mimeType?: string;
    };

    const platformMap: Record<string, SocialPlatformKey> = {
      tiktok: "tiktok",
      "instagram reels": "instagram",
      instagram: "instagram",
      "youtube shorts": "youtube",
      youtube: "youtube",
      linkedin: "linkedin",
      facebook: "facebook",
    };

    const key = platformMap[String(platform || "").toLowerCase()];
    if (!key) {
      res.status(400).json({ error: "Unsupported publishing platform." });
      return;
    }

    const { data } = getOrCreateSession(req, res);
    const token = data.tokens[key];
    if (!token?.accessToken) {
      res.status(401).json({
        error: `${PLATFORM_CONFIG[key].displayName} is not connected. Connect your account in Social Scheduler first.`,
      });
      return;
    }

    if (!videoBase64 || typeof videoBase64 !== "string") {
      res.status(400).json({ error: "Rendered video data is required for upload." });
      return;
    }

    const videoBuffer = Buffer.from(videoBase64, "base64");
    if (videoBuffer.length === 0) {
      res.status(400).json({ error: "Rendered video payload was empty." });
      return;
    }
    const contentType = mimeType || "video/webm";
    const safeTitle = (title || "ScaleReach Clip").slice(0, 95);
    const safeCaption = (captionText || safeTitle).slice(0, 2000);

    try {
      if (key === "youtube") {
        // Resumable upload to YouTube Shorts
        const initRes = await fetch(
          "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token.accessToken}`,
              "Content-Type": "application/json; charset=UTF-8",
              "X-Upload-Content-Length": String(videoBuffer.length),
              "X-Upload-Content-Type": contentType,
            },
            body: JSON.stringify({
              snippet: {
                title: `${safeTitle} #Shorts`,
                description: safeCaption,
                categoryId: "22",
              },
              status: { privacyStatus: "private" },
            }),
          }
        );
        const uploadUrl = initRes.headers.get("location");
        if (!initRes.ok || !uploadUrl) {
          const errText = await initRes.text();
          throw new Error(`YouTube upload init failed: ${errText}`);
        }
        const putRes = await fetch(uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": contentType },
          body: videoBuffer,
        });
        if (!putRes.ok) {
          throw new Error(`YouTube upload failed (${putRes.status})`);
        }
        const uploaded = (await putRes.json()) as { id?: string };
        res.json({
          ok: true,
          platform: "YouTube Shorts",
          remoteId: uploaded.id,
          url: uploaded.id ? `https://youtube.com/shorts/${uploaded.id}` : undefined,
        });
        return;
      }

      if (key === "tiktok") {
        const initRes = await fetch(
          "https://open.tiktokapis.com/v2/post/publish/video/init/",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token.accessToken}`,
              "Content-Type": "application/json; charset=UTF-8",
            },
            body: JSON.stringify({
              post_info: {
                title: safeCaption,
                privacy_level: "SELF_ONLY",
              },
              source_info: {
                source: "FILE_UPLOAD",
                video_size: videoBuffer.length,
                chunk_size: videoBuffer.length,
                total_chunk_count: 1,
              },
            }),
          }
        );
        const initData = (await initRes.json()) as {
          data?: { publish_id?: string; upload_url?: string };
          error?: { message?: string };
        };
        if (!initRes.ok || !initData.data?.upload_url) {
          throw new Error(initData.error?.message || "TikTok publish init failed");
        }
        const putRes = await fetch(initData.data.upload_url, {
          method: "PUT",
          headers: {
            "Content-Type": contentType,
            "Content-Range": `bytes 0-${videoBuffer.length - 1}/${videoBuffer.length}`,
          },
          body: videoBuffer,
        });
        if (!putRes.ok) {
          throw new Error(`TikTok chunk upload failed (${putRes.status})`);
        }
        res.json({
          ok: true,
          platform: "TikTok",
          remoteId: initData.data.publish_id,
        });
        return;
      }

      if (key === "linkedin") {
        if (!token.platformUserId) {
          throw new Error("LinkedIn member profile ID missing. Reconnect LinkedIn.");
        }
        const ownerUrn = `urn:li:person:${token.platformUserId}`;
        const regRes = await fetch(
          "https://api.linkedin.com/rest/videos?action=initializeUpload",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token.accessToken}`,
              "Content-Type": "application/json",
              "LinkedIn-Version": "202405",
            },
            body: JSON.stringify({
              initializeUploadRequest: {
                owner: ownerUrn,
                fileSizeBytes: videoBuffer.length,
                uploadCaptions: false,
                uploadThumbnail: false,
              },
            }),
          }
        );
        const regData = (await regRes.json()) as {
          value?: {
            video?: string;
            uploadInstructions?: Array<{ uploadUrl: string }>;
          };
          message?: string;
        };
        const uploadUrl = regData.value?.uploadInstructions?.[0]?.uploadUrl;
        const videoUrn = regData.value?.video;
        if (!regRes.ok || !uploadUrl || !videoUrn) {
          throw new Error(regData.message || "LinkedIn video init failed");
        }
        const putRes = await fetch(uploadUrl, {
          method: "PUT",
          headers: { "Content-Type": "application/octet-stream" },
          body: videoBuffer,
        });
        if (!putRes.ok) {
          throw new Error(`LinkedIn binary upload failed (${putRes.status})`);
        }
        res.json({
          ok: true,
          platform: "LinkedIn",
          remoteId: videoUrn,
        });
        return;
      }

      if (key === "facebook") {
        if (!token.hasPublishablePage || !token.platformUserId) {
          throw new Error(
            "No managed Facebook Page found on this login. Link a Facebook Page with pages_manage_posts & publish_video permissions and reconnect Facebook."
          );
        }
        const filename = contentType.includes("webm") ? "clip.webm" : "clip.mp4";
        const boundary = "----ScaleReachFBBoundary" + crypto.randomBytes(8).toString("hex");
        const headerBuf = Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="source"; filename="${filename}"\r\nContent-Type: ${contentType}\r\n\r\n`
        );
        const descBuf = Buffer.from(`\r\n--${boundary}\r\nContent-Disposition: form-data; name="description"\r\n\r\n${safeCaption}`);
        const footerBuf = Buffer.from(`\r\n--${boundary}--\r\n`);
        const bodyBuf = Buffer.concat([headerBuf, videoBuffer, descBuf, footerBuf]);

        const pageId = token.platformUserId;
        const fbRes = await fetch(
          `https://graph-video.facebook.com/v19.0/${encodeURIComponent(
            pageId
          )}/videos?access_token=${encodeURIComponent(token.accessToken)}`,
          {
            method: "POST",
            headers: {
              "Content-Type": `multipart/form-data; boundary=${boundary}`,
            },
            body: bodyBuf,
          }
        );
        const fbJson = (await fbRes.json()) as { id?: string; error?: { message?: string } };
        if (!fbRes.ok || !fbJson.id) {
          throw new Error(fbJson.error?.message || "Facebook video publish failed");
        }
        res.json({
          ok: true,
          platform: "Facebook",
          remoteId: fbJson.id,
          url: `https://facebook.com/${fbJson.id}`,
        });
        return;
      }

      // Instagram Reels requires a publicly accessible HTTPS video URL via Graph API
      if (!token.platformUserId) {
        throw new Error(
          "No Instagram Business Account linked to your Facebook login. Link an IG Professional account to publish Reels."
        );
      }
      throw new Error(
        "Instagram Reels Graph API requires a hosted public HTTPS MP4 URL; download the clip and upload via Meta Business Suite or configure a public media bucket."
      );
    } catch (err) {
      res.status(502).json({ error: parseReadableError(err) });
    }
  });

  /* ------------------------------------------------------------------------ */
  /* VIDEO INSPECT & GEMINI CLIP GENERATION ROUTES                            */
  /* ------------------------------------------------------------------------ */
  app.get("/api/video/thumbnail-proxy", async (req, res) => {
    try {
      const rawUrl = String(req.query.url || "").trim();
      if (!rawUrl || rawUrl.length > 2000) {
        res.status(400).send("Missing thumbnail URL");
        return;
      }
      const parsed = new URL(rawUrl);
      if (parsed.protocol !== "https:") {
        res.status(400).send("Only HTTPS thumbnail URLs are supported");
        return;
      }
      const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
      if (
        host === "localhost" ||
        host === "127.0.0.1" ||
        host === "0.0.0.0" ||
        host === "::1" ||
        host.endsWith(".local") ||
        host.endsWith(".internal") ||
        host.startsWith("10.") ||
        host.startsWith("127.") ||
        host.startsWith("169.254.") ||
        host.startsWith("192.168.") ||
        /^172\.(1[6-9]|2\d|3[0-1])\./.test(host) ||
        /^(fe80:|fc|fd)/i.test(host)
      ) {
        res.status(403).send("Blocked host");
        return;
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5000);
      const upstream = await fetch(parsed.toString(), {
        signal: controller.signal,
        redirect: "error",
        headers: { Accept: "image/*" },
      });
      clearTimeout(timer);

      if (!upstream.ok) {
        res.status(upstream.status).send("Upstream thumbnail error");
        return;
      }
      const contentType = upstream.headers.get("content-type") || "image/jpeg";
      if (!contentType.startsWith("image/")) {
        res.status(400).send("Target is not an image");
        return;
      }
      const buf = Buffer.from(await upstream.arrayBuffer());
      res.setHeader("Content-Type", contentType);
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Cache-Control", "public, max-age=3600");
      res.send(buf);
    } catch {
      res.status(502).send("Could not load thumbnail");
    }
  });

  app.post("/api/video/inspect", async (req, res) => {
    try {
      const { url } = req.body as { url?: string };
      if (!url || typeof url !== "string") {
        res.status(400).json({ error: "Please provide a valid video URL." });
        return;
      }

      const trimmedUrl = /^https?:\/\//i.test(url.trim())
        ? url.trim()
        : `https://${url.trim()}`;
      const youtubeId = extractYouTubeId(trimmedUrl);
      let title = "Untitled Video Stream";
      let channel = "Creator Channel";
      let thumbnailUrl = "";
      let durationSec = 1260;
      let language = "English";
      let topicSummary = "";

      const platform: "youtube" | "twitch" | "drive" | "direct" = youtubeId
        ? "youtube"
        : trimmedUrl.includes("twitch.tv")
        ? "twitch"
        : trimmedUrl.includes("drive.google.com")
        ? "drive"
        : "direct";

      if (youtubeId) {
        const canonical = `https://www.youtube.com/watch?v=${youtubeId}`;
        thumbnailUrl = `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`;

        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 3500);
          const oembedRes = await fetch(
            `https://www.youtube.com/oembed?url=${encodeURIComponent(canonical)}&format=json`,
            { signal: controller.signal }
          );
          clearTimeout(timer);
          if (oembedRes.ok) {
            const data = (await oembedRes.json()) as {
              title?: string;
              author_name?: string;
              thumbnail_url?: string;
            };
            if (data.title) title = data.title;
            if (data.author_name) channel = data.author_name;
            if (data.thumbnail_url) thumbnailUrl = data.thumbnail_url;
          }
        } catch {
          // Graceful fallback
        }

        if (process.env.GEMINI_API_KEY && title === "Untitled Video Stream") {
          try {
            const ai = getGeminiClient();
            const searchRes = await callGeminiWithFallback(
              ai,
              {
                contents: `Look up this YouTube video: ${canonical}. Return ONLY compact JSON: {"title":"","channel":"","durationSec":900,"language":"English","topicSummary":""}`,
                config: {
                  tools: [{ googleSearch: {} }],
                },
              },
              "gemini-3.1-flash-lite"
            );
            const raw = searchRes.text ?? "";
            const jsonMatch = raw.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              const parsed = JSON.parse(jsonMatch[0]);
              if (parsed.title) title = String(parsed.title);
              if (parsed.channel) channel = String(parsed.channel);
              if (typeof parsed.durationSec === "number" && parsed.durationSec > 30) {
                durationSec = Math.round(parsed.durationSec);
              }
              if (parsed.language) language = String(parsed.language);
              if (parsed.topicSummary) topicSummary = String(parsed.topicSummary);
            }
          } catch {
            // Keep graceful defaults
          }
        }
      } else {
        try {
          const u = new URL(trimmedUrl);
          const slug = u.pathname.split("/").filter(Boolean).pop();
          title = slug
            ? decodeURIComponent(slug).replace(/[-_]+/g, " ").replace(/\.\w+$/, "")
            : `${u.hostname} Video`;
          channel = u.hostname.replace(/^www\./, "");
        } catch {
          title = "Imported Video";
        }
      }

      res.json({
        url: trimmedUrl,
        youtubeId,
        platform,
        title,
        channel,
        thumbnailUrl,
        durationSec,
        language,
        topicSummary,
      });
    } catch (err) {
      res.status(500).json({ error: parseReadableError(err) });
    }
  });

  app.post("/api/clips/generate", async (req, res) => {
    try {
      const ai = getGeminiClient();
      const {
        title,
        channel,
        url,
        durationSec = 900,
        language = "English",
        clipType = "Viral Clips",
        customPrompt = "",
        targetDurationSec = 45,
        clipCount = 5,
        autoHook = true,
        timeframeStartSec = 0,
        timeframeEndSec = 900,
        userNotes = "",
        topicSummary = "",
        mediaBase64,
        mediaMimeType,
      } = req.body as {
        title?: string;
        channel?: string;
        url?: string;
        durationSec?: number;
        language?: string;
        clipType?: string;
        customPrompt?: string;
        targetDurationSec?: number;
        clipCount?: number;
        autoHook?: boolean;
        timeframeStartSec?: number;
        timeframeEndSec?: number;
        userNotes?: string;
        topicSummary?: string;
        mediaBase64?: string;
        mediaMimeType?: string;
      };

      const safeDuration = Math.max(15, Math.floor(Number(durationSec) || 900));
      const safeClipCount = Math.min(15, Math.max(1, Math.floor(Number(clipCount) || 5)));
      const safeStart = Math.max(
        0,
        Math.min(Math.floor(Number(timeframeStartSec) || 0), Math.max(0, safeDuration - 10))
      );
      const safeEnd = Math.min(
        safeDuration,
        Math.max(safeStart + 10, Math.floor(Number(timeframeEndSec) || safeDuration))
      );

      const promptText = `You are ScaleReach's AI video clipping, moment-scoring, and transcription engine.
Analyze the provided video source and extract EXACTLY ${safeClipCount} high-impact short-form clips ready for TikTok, Instagram Reels, and YouTube Shorts.

Video context:
- Title: "${title || "Creator Video"}"
- Creator / Channel: "${channel || "Creator"}"
- Source URL: "${url || "Uploaded file"}"
- Processing Window: ${safeStart}s to ${safeEnd}s (total video ${safeDuration}s)
- Output Language: ${language}
- Clipping Mode: ${clipType}
${customPrompt ? `- Custom Direction: ${customPrompt}` : ""}
- Requested Clip Count: ${safeClipCount} clips
- Target Clip Length: roughly ${Math.min(targetDurationSec, Math.max(15, safeEnd - safeStart))} seconds per clip
- Auto Hook Enabled: ${autoHook}
${topicSummary ? `- Video Context Summary: ${topicSummary}` : ""}
${userNotes ? `- Transcript / Notes from Creator:\n${userNotes}` : ""}

Requirements for EVERY clip:
1. Return EXACTLY ${safeClipCount} clips ranked #1 through #${safeClipCount} from highest Virality Score to lowest (scores between 76 and 96).
2. Spread startTimeSec and endTimeSec realistically across ${safeStart}..${safeEnd}, keeping endTimeSec <= ${safeEnd} and duration = endTimeSec - startTimeSec (between 10s and 65s).
3. Provide a sharp, scroll-stopping "hookTitle" (3 to 7 words) suitable for an on-screen top banner.
4. Provide realistic "hookStrength" (0-100) and "pacingScore" (0-100) plus a clear, specific 2-sentence "whyViral" explanation detailing why the opening 3 seconds hook viewers and how pacing sustains retention.
5. Generate an authentic spoken "transcript" as an array of 4 to 6 timed cues covering the clip from startOffsetSec = 0 up to the clip's duration. Each cue must be 1-2 natural spoken sentences with 1-3 key "emphasisWords" from that cue for animated word highlighting.
6. Write all titles, hooks, explanations, and transcript cues in ${language}.
7. Identify the video's niche/type as "videoCategory" (e.g., "Podcast", "Tech & AI", "Travel Vlog", "Comedy", "Education", "Gaming", "Business") and generate 5 to 7 relevant short-form "hashtags" (each starting with #, no spaces, tailored to the video type, topic, and language).`;

      const generationConfig = {
        systemInstruction:
          "You are an expert short-form video producer and retention strategist. Return crisp, well-timed, authentic spoken transcripts and honest virality evaluations as structured JSON.",
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            summary: {
              type: Type.STRING,
              description: "1-sentence summary of the source video content.",
            },
            clips: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  rank: { type: Type.INTEGER },
                  title: { type: Type.STRING },
                  hookTitle: { type: Type.STRING },
                  startTimeSec: { type: Type.INTEGER },
                  endTimeSec: { type: Type.INTEGER },
                  viralityScore: { type: Type.INTEGER },
                  hookStrength: { type: Type.INTEGER },
                  pacingScore: { type: Type.INTEGER },
                  whyViral: { type: Type.STRING },
                  videoCategory: { type: Type.STRING },
                  hashtags: {
                    type: Type.ARRAY,
                    items: { type: Type.STRING },
                  },
                  transcript: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        startOffsetSec: { type: Type.NUMBER },
                        endOffsetSec: { type: Type.NUMBER },
                        text: { type: Type.STRING },
                        emphasisWords: {
                          type: Type.ARRAY,
                          items: { type: Type.STRING },
                        },
                      },
                      required: ["startOffsetSec", "endOffsetSec", "text", "emphasisWords"],
                    },
                  },
                },
                required: [
                  "rank",
                  "title",
                  "hookTitle",
                  "startTimeSec",
                  "endTimeSec",
                  "viralityScore",
                  "hookStrength",
                  "pacingScore",
                  "whyViral",
                  "videoCategory",
                  "hashtags",
                  "transcript",
                ],
              },
            },
          },
          required: ["summary", "clips"],
        },
      };

      let response;
      if (mediaBase64 && mediaMimeType) {
        try {
          response = await callGeminiWithFallback(ai, {
            contents: {
              parts: [
                {
                  inlineData: {
                    mimeType: mediaMimeType,
                    data: mediaBase64,
                  },
                },
                { text: promptText },
              ],
            },
            config: generationConfig,
          });
        } catch (mediaErr) {
          console.warn(
            "Inline media generation failed, falling back to metadata prompt:",
            parseReadableError(mediaErr)
          );
          response = await callGeminiWithFallback(ai, {
            contents: { parts: [{ text: promptText }] },
            config: generationConfig,
          });
        }
      } else {
        response = await callGeminiWithFallback(ai, {
          contents: { parts: [{ text: promptText }] },
          config: generationConfig,
        });
      }

      const rawJson = (response.text ?? "{}").trim();
      const parsed = JSON.parse(rawJson) as {
        summary?: string;
        clips?: Array<Record<string, unknown>>;
      };
      if (Array.isArray(parsed.clips)) {
        parsed.clips = parsed.clips.slice(0, safeClipCount).map((clip) => {
          const rawS = Math.max(0, Math.floor(Number(clip.startTimeSec) || 0));
          const clampedStart = Math.min(rawS, Math.max(0, safeDuration - 10));
          const rawE = Math.max(clampedStart + 10, Math.floor(Number(clip.endTimeSec) || clampedStart + 30));
          const clampedEnd = Math.min(safeDuration, rawE);
          return {
            ...clip,
            startTimeSec: clampedStart,
            endTimeSec: Math.max(clampedStart + 5, clampedEnd),
          };
        });
      }
      res.json(parsed);
    } catch (err) {
      res.status(500).json({ error: parseReadableError(err) });
    }
  });

  app.post("/api/clips/hashtags", async (req, res) => {
    try {
      const ai = getGeminiClient();
      const {
        title = "",
        projectTitle = "",
        clipType = "Viral Clips",
        language = "English",
        platform = "TikTok",
        transcriptText = "",
      } = req.body as {
        title?: string;
        projectTitle?: string;
        clipType?: string;
        language?: string;
        platform?: string;
        transcriptText?: string;
      };

      if (!title && !projectTitle && !transcriptText) {
        res.status(400).json({ error: "Provide clip details to generate hashtags." });
        return;
      }

      const response = await callGeminiWithFallback(ai, {
        contents: `Analyze this short-form video clip and generate automatic video-type classification and high-performing hashtags for ${platform}.

Clip Title: "${title}"
Source Video: "${projectTitle}"
Clip Type: "${clipType}"
Language: "${language}"
Transcript Excerpt: "${transcriptText.slice(0, 800)}"

Requirements:
1. Classify the video niche/type into a short 1-3 word "videoCategory" (e.g., "Tech Podcast", "Travel Vlog", "Comedy Skit", "Startup Advice", "Tutorial").
2. Generate 5 to 8 relevant, non-generic hashtags in "hashtags" (each starting with #, camelCase or lowercase with no spaces, mixing niche topic tags + video-type tags + 1-2 platform discovery tags for ${platform}).
3. Provide a ready-to-post "suggestedCaption" (1 punchy hook sentence followed by the hashtags).`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              videoCategory: { type: Type.STRING },
              hashtags: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              suggestedCaption: { type: Type.STRING },
            },
            required: ["videoCategory", "hashtags", "suggestedCaption"],
          },
        },
      },
      "gemini-3.1-flash-lite"
    );

      const parsed = JSON.parse((response.text ?? "{}").trim()) as {
        videoCategory?: string;
        hashtags?: string[];
        suggestedCaption?: string;
      };

      const cleanedTags = (Array.isArray(parsed.hashtags) ? parsed.hashtags : [])
        .map((t) => {
          const clean = String(t || "")
            .trim()
            .replace(/^#+/, "")
            .replace(/[^\p{L}\p{N}_]/gu, "");
          return clean ? `#${clean}` : "";
        })
        .filter(Boolean);

      res.json({
        videoCategory: parsed.videoCategory || clipType,
        hashtags: cleanedTags,
        suggestedCaption: parsed.suggestedCaption || `${title} ${cleanedTags.join(" ")}`,
      });
    } catch (err) {
      res.status(500).json({ error: parseReadableError(err) });
    }
  });

  app.post("/api/clips/translate", async (req, res) => {
    try {
      const ai = getGeminiClient();
      const { title, hookTitle, transcript, targetLanguage } = req.body as {
        title: string;
        hookTitle: string;
        transcript: Array<{
          id?: string;
          startOffsetSec: number;
          endOffsetSec: number;
          text: string;
          emphasisWords: string[];
        }>;
        targetLanguage: string;
      };

      if (!targetLanguage || !Array.isArray(transcript)) {
        res.status(400).json({ error: "Missing transcript or targetLanguage." });
        return;
      }

      const response = await callGeminiWithFallback(ai, {
        contents: `Translate the following short-form video clip metadata and timed caption cues naturally into ${targetLanguage}.
Preserve exact cue count, startOffsetSec, and endOffsetSec values. Update emphasisWords so each contains 1-3 words that appear in the translated cue text.

Input JSON:
${JSON.stringify({ title, hookTitle, transcript })}`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING },
              hookTitle: { type: Type.STRING },
              transcript: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    startOffsetSec: { type: Type.NUMBER },
                    endOffsetSec: { type: Type.NUMBER },
                    text: { type: Type.STRING },
                    emphasisWords: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING },
                    },
                  },
                  required: ["startOffsetSec", "endOffsetSec", "text", "emphasisWords"],
                },
              },
            },
            required: ["title", "hookTitle", "transcript"],
          },
        },
      });

      const parsed = JSON.parse((response.text ?? "{}").trim());
      res.json(parsed);
    } catch (err) {
      res.status(500).json({ error: parseReadableError(err) });
    }
  });

  app.post("/api/assistant/chat", async (req, res) => {
    try {
      const ai = getGeminiClient();
      const { message, projectContext } = req.body as {
        message: string;
        projectContext: {
          projectTitle: string;
          aspectRatio: string;
          captionStyle: string;
          clips: Array<{
            id: string;
            rank: number;
            title: string;
            viralityScore: number;
            durationSec: number;
            whyViral: string;
          }>;
        };
      };

      if (!message) {
        res.status(400).json({ error: "Message is required." });
        return;
      }

      const response = await callGeminiWithFallback(ai, {
        contents: `User request: "${message}"

Current active video project context:
${JSON.stringify(projectContext, null, 2)}

Valid captionStyle IDs: classic, cyan-slide, italic-red, red-spin, violet, blue-glow, emerald-pop, minimal-serif
Valid aspectRatio values: 9:16, 16:9, 1:1

Respond concisely as ScaleReach's AI Clipping Copilot. If the user asks to apply a change (restyle captions, change aspect ratio, filter by virality score, or jump to/translate a specific clip), return the matching structured action so the UI executes it immediately.`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              reply: { type: Type.STRING },
              action: {
                type: Type.OBJECT,
                properties: {
                  type: {
                    type: Type.STRING,
                    description:
                      "One of: none, switch_style, switch_aspect, filter_score, open_clip_editor, translate_clip",
                  },
                  captionStyle: { type: Type.STRING },
                  aspectRatio: { type: Type.STRING },
                  minScore: { type: Type.INTEGER },
                  clipId: { type: Type.STRING },
                  targetLanguage: { type: Type.STRING },
                },
                required: ["type"],
              },
            },
            required: ["reply", "action"],
          },
        },
      });

      const parsed = JSON.parse((response.text ?? "{}").trim());
      res.json(parsed);
    } catch (err) {
      res.status(500).json({ error: parseReadableError(err) });
    }
  });

  const TIKTOK_SITE_VERIFICATION =
    process.env.TIKTOK_SITE_VERIFICATION?.trim() ||
    "tiktok-developers-site-verification=gxSwPPeOOK0BHXw2Ull9SlaF6NjouonY";

  app.get(
    /^\/(?:(?:terms|privacy|\.well-known)\/)?tiktok[a-zA-Z0-9_=-]*\.txt$/,
    (_req, res) => {
      res.setHeader("Cache-Control", "public, max-age=300");
      res.type("text/plain; charset=utf-8").send(TIKTOK_SITE_VERIFICATION);
    }
  );

  const renderLegalPage = (title: string, updated: string, bodyHtml: string) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="tiktok-developers-site-verification" content="gxSwPPeOOK0BHXw2Ull9SlaF6NjouonY" />
    <title>${escapeHtmlText(title)} — AI Video Clip Generator</title>
    <style>
      body { margin: 0; background: #0a0a0c; color: #e4e4e7; font-family: system-ui, -apple-system, sans-serif; line-height: 1.65; }
      main { max-width: 780px; margin: 0 auto; padding: 48px 24px 64px; }
      h1 { color: #ffffff; font-size: 28px; margin: 0 0 8px; }
      h2 { color: #ffffff; font-size: 18px; margin: 28px 0 8px; }
      p, li { color: #a1a1aa; font-size: 15px; }
      .meta { color: #71717a; font-size: 13px; margin-bottom: 28px; }
      a { color: #60a5fa; text-decoration: none; }
      a:hover { text-decoration: underline; }
      .nav { display: flex; gap: 16px; margin-bottom: 32px; font-size: 14px; }
    </style>
  </head>
  <body>
    <main>
      <div class="nav">
        <a href="/">Home</a>
        <a href="/terms">Terms of Service</a>
        <a href="/privacy">Privacy Policy</a>
      </div>
      <h1>${escapeHtmlText(title)}</h1>
      <p class="meta">AI Video Clip Generator · Developer: HBM · Last updated: ${escapeHtmlText(updated)}</p>
      ${bodyHtml}
    </main>
  </body>
</html>`;

  app.get(["/terms", "/terms/"], (_req, res) => {
    res.type("html").send(
      renderLegalPage(
        "Terms of Service",
        "November 22, 2026",
        `
          <h2>1. Acceptance of Terms</h2>
          <p>By accessing or using AI Video Clip Generator (operated by HBM), you agree to these Terms of Service and all applicable laws and platform guidelines.</p>
          <h2>2. Permitted Use &amp; Content Ownership</h2>
          <p>You retain full ownership of the videos, audio, captions, and clips you upload, edit, or export. You confirm that you hold the necessary rights or permissions to process any video URL or media file submitted to the application.</p>
          <h2>3. Connected Social Accounts</h2>
          <p>When you connect TikTok, YouTube, Instagram, Facebook, or LinkedIn via OAuth, you authorize AI Video Clip Generator to publish clips and captions solely at your explicit request or according to schedules you configure.</p>
          <h2>4. Service Availability</h2>
          <p>AI clip analysis, transcription, translation, and social publishing depend on third-party APIs and platform limits. Features are provided on an "as-is" and "as-available" basis.</p>
          <h2>5. Account &amp; Access Termination</h2>
          <p>You may disconnect any linked social account or stop using the service at any time from the Social Scheduler dashboard.</p>
        `
      )
    );
  });

  app.get(["/privacy", "/privacy/"], (_req, res) => {
    res.type("html").send(
      renderLegalPage(
        "Privacy Policy",
        "November 22, 2026",
        `
          <h2>1. Information We Process</h2>
          <p>AI Video Clip Generator processes video links, uploaded media metadata, transcripts, generated clip configurations, and scheduled post details needed to create and export short-form video clips.</p>
          <h2>2. Authentication &amp; Social OAuth Data</h2>
          <p>If you sign in with Google or connect a social platform (TikTok, YouTube, Instagram, Facebook, or LinkedIn), we receive basic profile identifiers (such as display name or handle) and temporary access tokens stored securely in HTTP-only server sessions solely to perform publishing actions you initiate.</p>
          <h2>3. How We Use Your Data</h2>
          <ul>
            <li>Analyze video moments, generate captions, and translate subtitles.</li>
            <li>Sync your projects, brand templates, and scheduled posts when signed in.</li>
            <li>Publish rendered clips to your explicitly connected social channels.</li>
          </ul>
          <h2>4. Data Sharing &amp; Storage</h2>
          <p>We do not sell your personal data. Media prompts and publishing requests are transmitted only to the AI and social media APIs required to fulfill your requested actions.</p>
          <h2>5. Revoking Access &amp; Deletion</h2>
          <p>You can disconnect any connected social account immediately inside the Social Scheduler tab, or revoke app access directly from your TikTok, Google, Meta, or LinkedIn account security settings.</p>
        `
      )
    );
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, "dist");
    app.use(express.static(distPath));
    app.get("/{*path}", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`ScaleReach server running at http://localhost:${PORT}`);
  });
}

startServer();
