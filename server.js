import path from "node:path";
import fs from "node:fs";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import express from "express";
import { ElevenLabsClient, ElevenLabsError } from "@elevenlabs/elevenlabs-js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT = Number(process.env.PORT || 3000);
const DEFAULT_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb"; // getting-started snippet voice
const DEFAULT_TEXT = "The first move is what sets everything in motion.";
const MAX_TEXT_CHARS = 5000;

const MODELS = {
  eleven_multilingual_v2: {
    name: "Multilingual v2",
    description: "Best quality & stability. 29 languages. The snippet's model.",
    speedBadge: "max quality",
    supportsSpeed: false,
  },
  eleven_turbo_v2_5: {
    name: "Turbo v2.5",
    description: "Great balance of latency and quality, 32 languages.",
    speedBadge: "balanced",
    supportsSpeed: true,
  },
  eleven_flash_v2_5: {
    name: "Flash v2.5",
    description: "Ultra-low latency, ~half the character cost. 32 languages.",
    speedBadge: "fastest",
    supportsSpeed: true,
  },
};

const OUTPUT_FORMATS = {
  mp3_44100_128: "mp3 · 44.1 kHz · 128 kbps",
  mp3_44100_64: "mp3 · 44.1 kHz · 64 kbps",
  mp3_44100_32: "mp3 · 44.1 kHz · 32 kbps",
};

// Ranges exposed to the UI and enforced server-side.
const VOICE_SETTINGS = {
  stability: { min: 0, max: 1, step: 0.01, default: 0.5 },
  similarityBoost: { min: 0, max: 1, step: 0.01, default: 0.75 },
  style: { min: 0, max: 1, step: 0.01, default: 0 },
  useSpeakerBoost: { default: true },
  // `speed` only reaches ElevenLabs on models that support it (see MODELS).
  speed: { min: 0.7, max: 1.2, step: 0.05, default: 1 },
};

if (!process.env.ELEVENLABS_API_KEY) {
  console.warn(
    "[warn] ELEVENLABS_API_KEY is not set. Copy .env.example to .env and add your key from https://elevenlabs.io (Profile → API Keys).",
  );
}

let _client = null;

// Created lazily: the SDK throws at construction time when no API key is set,
// and we want the server (and UI) to still come up and explain itself.
function client() {
  if (_client === null) {
    if (!process.env.ELEVENLABS_API_KEY) {
      const err = new Error(
        "No API key configured. Add your ElevenLabs key to .env (see .env.example) and restart.",
      );
      err.statusCode = 503;
      throw err;
    }
    // Defaults to process.env.ELEVENLABS_API_KEY, like the getting-started snippet.
    // ELEVENLABS_BASE_URL is a test hook: it points the SDK at a local mock upstream.
    _client = process.env.ELEVENLABS_BASE_URL
      ? new ElevenLabsClient({ baseUrl: process.env.ELEVENLABS_BASE_URL })
      : new ElevenLabsClient();
  }
  return _client;
}

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "32kb" }));

// Minimal request log.
app.use((req, res, next) => {
  const started = performance.now();
  res.on("finish", () =>
    console.log(`${req.method} ${req.path} -> ${res.statusCode} (${(performance.now() - started).toFixed(0)}ms)`),
  );
  next();
});

// Config + defaults, so the UI and the server stay in sync.
app.get("/api/meta", (_req, res) => {
  res.json({
    models: MODELS,
    outputFormats: OUTPUT_FORMATS,
    voiceSettings: VOICE_SETTINGS,
    defaultVoiceId: DEFAULT_VOICE_ID,
    defaultText: DEFAULT_TEXT,
    maxTextChars: MAX_TEXT_CHARS,
  });
});

// Liveness probe for Docker: /api/meta always answers 200 (it is the config
// endpoint the UI renders from), so it can't detect a missing API key.
app.get("/api/health", (_req, res) => {
  const apiKeyConfigured = Boolean(process.env.ELEVENLABS_API_KEY);
  res.status(apiKeyConfigured ? 200 : 503).json({ ok: apiKeyConfigured, apiKeyConfigured });
});

// Account quota (character usage + tier), refreshed by the UI.
app.get("/api/quota", async (_req, res) => {
  try {
    const sub = await client().user.subscription.get();
    // The client destructures `{ quota, error }`, so the payload must be nested.
    res.json({
      quota: {
        tier: sub.tier,
        characterCount: sub.characterCount,
        characterLimit: sub.characterLimit,
        nextResetUnix: sub.nextCharacterCountResetUnix ?? null,
      },
    });
  } catch (err) {
    const { status, error, kind } = describeError(err);
    res.status(status).json({ error, kind, quota: null });
  }
});

// Voices + preview URL for the in-app voice auditioning.
app.get("/api/voices", async (_req, res) => {
  try {
    const voices = await fetchAllVoices();
    res.json({
      voices: voices.map((v) => ({
        id: v.voiceId,
        name: v.name || v.voiceId,
        category: v.category ?? null,
        labels: v.labels ?? {},
        previewUrl: v.previewUrl ?? null,
      })),
    });
  } catch (err) {
    res.json({
      voices: [{ id: DEFAULT_VOICE_ID, name: "Default voice", category: null, labels: {}, previewUrl: null }],
      warning: describeError(err).error,
    });
  }
});

/**
 * The voices endpoint defaults to 10 voices per page, which silently truncated
 * the list (the client search box only filters what we send). Ask for the
 * maximum page size and follow `next_page_token` until `has_more` is false.
 */
async function fetchAllVoices() {
  const PAGE_SIZE = 100; // API maximum
  const MAX_PAGES = 20; // hard cap: a non-advancing token must not loop forever
  const all = [];
  let nextPageToken;

  for (let page = 0; page < MAX_PAGES; page++) {
    // `nextPageToken` is only sent once we actually have one — passing
    // `undefined` through the SDK would be a type error.
    const request = { pageSize: PAGE_SIZE };
    if (nextPageToken !== undefined) request.nextPageToken = nextPageToken;

    const pageData = await client().voices.search(request);
    all.push(...(pageData.voices ?? []));
    if (!pageData.hasMore) break;
    nextPageToken = pageData.nextPageToken;
    if (nextPageToken === undefined) break; // no token to continue with
  }

  return all;
}

app.post("/api/tts", async (req, res) => {
  const {
    text,
    voiceId = DEFAULT_VOICE_ID,
    modelId = "eleven_multilingual_v2",
    outputFormat = "mp3_44100_128",
    voiceSettings,
  } = req.body ?? {};

  if (typeof text !== "string" || text.trim().length === 0) {
    return res.status(400).json({ error: "Text is required." });
  }
  if (text.length > MAX_TEXT_CHARS) {
    return res.status(400).json({ error: `Text is too long (max ${MAX_TEXT_CHARS} characters).` });
  }
  if (!(modelId in MODELS)) {
    return res.status(400).json({ error: `Unknown model: ${modelId}` });
  }
  if (typeof outputFormat !== "string" || !(outputFormat in OUTPUT_FORMATS)) {
    return res.status(400).json({ error: `Unknown output format: ${outputFormat}` });
  }
  if (typeof voiceId !== "string" || /^[A-Za-z0-9]{10,30}$/.test(voiceId) === false) {
    return res.status(400).json({ error: "Invalid voice id." });
  }

  const settings = sanitizeVoiceSettings(voiceSettings, modelId);
  if (settings === false) {
    return res.status(400).json({ error: "Invalid voice settings values." });
  }

  const params = { text, modelId, outputFormat };
  if (settings) {
    params.voiceSettings = settings;
  }

  // Log what we actually send upstream (never the text itself) so the
  // effective `speed`/voice settings are observable end-to-end.
  console.log(
    `[tts] model=${modelId} format=${outputFormat} chars=${text.length} voiceSettings=${JSON.stringify(settings ?? {})}`,
  );

  try {
    const audio = await client().textToSpeech.convert(voiceId, params);

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "no-store");

    // convert() yields a web ReadableStream (older versions: a Node Readable) —
    // bridge either one to the HTTP response.
    const stream =
      typeof audio?.getReader === "function" ? Readable.fromWeb(audio) : audio;
    if (!stream || typeof stream.pipe !== "function") {
      throw new Error("Unexpected audio payload from SDK");
    }
    stream.pipe(res);
    stream.on("error", () => res.destroy());
  } catch (err) {
    const { status, kind, error } = describeError(err);
    console.error(`[tts] voice=${voiceId} model=${modelId} kind=${kind}: ${error}`);
    res.status(status).json({ error, kind });
  }
});

/**
 * Validates UI voice settings against the ranges in VOICE_SETTINGS,
 * dropping `speed` for models that don't support it (multilingual_v2).
 */
function sanitizeVoiceSettings(candidate, modelId) {
  if (candidate === undefined || candidate === null) return null;
  if (typeof candidate !== "object" || Array.isArray(candidate)) return false;

  const out = {};
  for (const [key, spec] of Object.entries(VOICE_SETTINGS)) {
    const value = candidate[key];
    if (value === undefined) continue;
    if (key === "useSpeakerBoost") {
      if (typeof value === "boolean") out[key] = value;
      else return false;
      continue;
    }
    if (typeof value !== "number" || !Number.isFinite(value) || value < spec.min || value > spec.max) {
      return false;
    }
    // ElevenLabs rejects `speed` on multilingual_v2, so it is dropped there.
    // Note: the range check above runs first, so an out-of-range `speed` is
    // rejected with 400 even for models that would have dropped it anyway.
    if (key === "speed") {
      if (MODELS[modelId]?.supportsSpeed) out[key] = Number(value.toFixed(2));
    } else {
      out[key] = Number(value.toFixed(2));
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

function describeError(err) {
  const hasStatus = Number.isInteger(err?.statusCode);
  const status = hasStatus ? err.statusCode : 502;
  const d = takeDetail(err);

  // The SDK raises ElevenLabsError for HTTP responses (it carries the status
  // code) and for transport failures (it doesn't). A ParseError means the
  // response body didn't match the schema the SDK expects.
  const httpError = err instanceof ElevenLabsError && hasStatus;
  const schemaError = err?.name === "ParseError";
  // No status code at all => the request never got an answer from ElevenLabs.
  const network = !httpError && !hasStatus && !schemaError;

  // `${status} ${d.status} ${d.code} ${d.message}` in one lowercase haystack,
  // so classification doesn't depend on where ElevenLabs puts the hint
  // (401 "quota_exceeded", 402 "insufficient_credits", 429 …).
  const hay = `${status} ${d.status ?? ""} ${d.code ?? ""} ${d.type ?? ""} ${d.message ?? ""}`
    .toLowerCase();

  // A schema failure is an upstream problem, not a connectivity one: the
  // response arrived, it just didn't look like what the SDK expects.
  if (schemaError) {
    return {
      status,
      kind: "upstream",
      error: `ElevenLabs returned an unexpected response format. (${d.text})`,
    };
  }

  // Quota errors arrive as 401/400 `quota_exceeded`, 402 `insufficient_credits`
  // or a 401 "exceeds your quota limit" message — never assume 4xx = bad key.
  const quota = summarizeQuota(d);
  if (status === 402 || /quota_exceeded|insufficient_credits|payment_required/.test(hay) || /quota/.test(hay)) {
    return {
      status,
      kind: "quota",
      error: `You're out of ElevenLabs characters for this billing cycle${quota ?? ""}. Top up your plan or wait for the next reset. (${d.text})`,
    };
  }
  if (status === 401 || /invalid_api_key|missing_api_key|unauthorized/.test(hay)) {
    if (/permission|user_read|doesn.t have access/.test(hay)) {
      return {
        status,
        kind: "permission",
        error: `Your ElevenLabs API key is missing a required permission (401). (${d.text})`,
      };
    }
    return {
      status,
      kind: "auth",
      error: `Authentication failed (401). Check ELEVENLABS_API_KEY in .env. (${d.text})`,
    };
  }
  if (status === 429 || /rate_limit|concurrent_limit/.test(hay)) {
    const busy = /concurrent/.test(hay) ? "Too many concurrent requests" : "Rate limited by ElevenLabs";
    const wait = readRetryAfter(err);
    return {
      status,
      kind: "rate_limit",
      error: `${busy} (429).${wait ? ` Try again in ${wait}.` : " Try again in a moment."} (${d.text})`,
    };
  }
  if (status === 403) {
    return {
      status,
      kind: "permission",
      error: `Your ElevenLabs plan doesn't allow this action (403). (${d.text})`,
    };
  }
  if (status === 422 || status === 400) {
    return { status, kind: "validation", error: `ElevenLabs rejected the request (HTTP ${status}). (${d.text})` };
  }
  if (network) {
    return { status, kind: "network", error: `Could not reach ElevenLabs. Check your connection and try again. (${d.text})` };
  }
  if (status >= 500) {
    return { status, kind: "upstream", error: `ElevenLabs had a server problem (HTTP ${status}). Try again. (${d.text})` };
  }
  return { status, kind: "unknown", error: `ElevenLabs request failed (HTTP ${status}). (${d.text})` };
}

/**
 * Normalizes `err.body.detail` into `status/code/type/message` plus a single
 * `text` fallback — SDK bodies vary: `detail` may be a rich object or a string.
 */
function takeDetail(err) {
  const raw = err?.body?.detail;
  const detail =
    typeof raw === "string"
      ? { message: raw }
      : { status: raw?.status, code: raw?.code, type: raw?.type, message: raw?.message };
  const text =
    detail.message || detail.code || detail.status || (raw != null ? JSON.stringify(raw) : null) || err?.message || "unknown error";
  return { ...detail, text };
}

/** `character_used`/`character_limit` sent with older quotas — "(10,059/10,000 characters used)". */
function summarizeQuota(d) {
  if (typeof d?.message === "string") {
    const m = d.message.match(/(\d[\d,]*)\s+characters? remaining/i);
    if (m) return ` (${m[1]} characters left)`;
  }
  if (Number.isFinite(d?.character_used) && Number.isFinite(d?.character_limit)) {
    return ` (${d.character_used.toLocaleString("en-US")}/${d.character_limit.toLocaleString("en-US")} characters used)`;
  }
  return "";
}

/** Retry-After header of the upstream response, when the SDK kept it. */
function readRetryAfter(err) {
  const raw = err?.rawResponse?.headers?.get?.("retry-after");
  if (raw == null) return null;
  const s = Number(raw);
  return Number.isFinite(s) ? `${Math.ceil(s)}s` : raw;
}

// Serve the Vite production build when present.
const distDir = path.join(__dirname, "dist");
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
} else {
  app.get("/", (_req, res) =>
    res
      .status(503)
      .send("Frontend not built yet. Run `npm run build` (or `npm run dev` for the dev server)."),
  );
}

// Unknown API route -> JSON 404.
app.use("/api", (_req, res) => res.status(404).json({ error: "Not found." }));

// Catch-all error handler: express 5 forwards async rejections and
// body-parser failures here, and its default handler answers with an HTML
// page the client can't parse ("Request failed (HTTP 500)"). Always answer JSON.
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error("[error]", err?.type ?? "", err?.message ?? err);
  if (res.headersSent) return void res.destroy();
  const known = err?.type === "entity.parse.failed" || err?.type === "entity.too.large";
  res
    .status(Number.isInteger(err?.statusCode) ? err.statusCode : 500)
    .json({ error: known ? `Bad request: ${err.message}` : `Server error: ${err?.message ?? "unexpected failure"}` });
});

const server = app.listen(PORT, () => {
  console.log(`Voice Studio listening on http://localhost:${PORT}`);
});

// Graceful shutdown.
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    console.log(`\n${signal} received — shutting down.`);
    server.close(() => process.exit(0));
  });
}
