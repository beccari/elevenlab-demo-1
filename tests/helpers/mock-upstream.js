"use strict";

/**
 * A stand-in for the ElevenLabs HTTP API.
 *
 * The ElevenLabs SDK is pointed at this server through the `ELEVENLABS_BASE_URL`
 * test hook in server.js, so the real API is never contacted from a test.
 *
 * Every request is recorded so a test can assert on what the server actually
 * sent upstream (e.g. whether `voice_settings.speed` made it through).
 */

const http = require("node:http");

/** A body that satisfies the SDK's `Subscription` schema. */
const VALID_SUBSCRIPTION = {
  tier: "free",
  character_count: 1234,
  character_limit: 10000,
  max_credit_limit_extension: 100,
  can_extend_character_limit: false,
  allowed_to_extend_character_limit: false,
  next_character_count_reset_unix: 1735689600,
  voice_slots_used: 1,
  professional_voice_slots_used: 0,
  professional_voice_slots_used_in_workspace: 0,
  voice_limit: 20,
  can_extend_voice_limit: false,
  max_voice_add_edits: 10,
  voice_add_edit_counter: 0,
  professional_voice_limit: 20,
  can_use_instant_voice_cloning: false,
  can_use_professional_voice_cloning: false,
  currency: "usd",
  current_overage: { amount: "0", currency: "usd" },
  status: "free",
  open_invoices: [],
  has_open_invoices: false,
};

/** A few bytes of "mp3" so the app can pipe a response body. */
const FAKE_AUDIO = Buffer.from([
  0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);

function createMockUpstream(options = {}) {
  const recorded = {
    /** Every POST /v1/text-to-speech/* body the app sent. */
    tts: [],
    /** Every GET /v2/voices query the app sent. */
    voices: [],
    /** Every GET /v1/user/subscription request. */
    subscription: [],
    /** Anything that hit an unknown route. */
    unknown: [],
  };

  const config = {
    /** HTTP status for the text-to-speech endpoint. */
    ttsStatus: 200,
    /** When set, the TTS endpoint answers with this JSON body instead of audio. */
    ttsBody: undefined,
    /** HTTP status for the subscription endpoint. */
    subscriptionStatus: 200,
    /** Body for the subscription endpoint. */
    subscriptionBody: VALID_SUBSCRIPTION,
    /**
     * Pages for GET /v2/voices. Page 0 is returned when no `next_page_token`
     * is sent; the token in `voicePageByToken` selects the follow-up page.
     */
    voicePages: [{ voices: [], hasMore: false, nextPageToken: undefined }],
    voicePageByToken: {},
    ...options,
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const query = Object.fromEntries(url.searchParams.entries());

    if (req.method === "POST" && url.pathname.startsWith("/v1/text-to-speech/")) {
      const chunks = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        let body = null;
        try {
          body = JSON.parse(raw);
        } catch {
          body = null;
        }
        recorded.tts.push({ body, raw, query, path: url.pathname });

        if (config.ttsBody !== undefined) {
          res.writeHead(config.ttsStatus, { "Content-Type": "application/json" });
          res.end(JSON.stringify(config.ttsBody));
          return;
        }
        res.writeHead(config.ttsStatus, { "Content-Type": "audio/mpeg" });
        res.end(FAKE_AUDIO);
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/v1/user/subscription") {
      recorded.subscription.push({ query, path: url.pathname });
      if (config.subscriptionStatus >= 400) {
        res.writeHead(config.subscriptionStatus, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            detail: {
              status: config.subscriptionStatus,
              message: "Unauthorized",
              code: "unauthorized",
            },
          }),
        );
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(config.subscriptionBody));
      return;
    }

    if (req.method === "GET" && url.pathname === "/v2/voices") {
      recorded.voices.push({ query, path: url.pathname });
      const token = url.searchParams.get("next_page_token");
      // No token => the first page; a token => the page it points at.
      const page =
        token === null
          ? config.voicePages[0]
          : (config.voicePageByToken[token] ?? { voices: [], hasMore: false });
      const payload = {
        voices: page.voices,
        has_more: page.hasMore ?? false,
        total_count: config.voicePages.reduce((sum, p) => sum + (p.voices?.length ?? 0), 0),
      };
      if (page.nextPageToken !== undefined) payload.next_page_token = page.nextPageToken;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(payload));
      return;
    }

    recorded.unknown.push({ method: req.method, path: url.pathname, query });
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ detail: { status: 404, message: "Not found" } }));
  });

  return {
    server,
    config,
    recorded,
    /** Starts on an ephemeral port; resolves with the assigned base URL. */
    listen() {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
          const { port } = server.address();
          this.url = `http://127.0.0.1:${port}`;
          resolve(this.url);
        });
      });
    },
    close() {
      return new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      });
    },
  };
}

/** Builds `count` voices shaped like the ElevenLabs API response. */
function makeVoices(prefix, count) {
  return Array.from({ length: count }, (_, i) => ({
    voice_id: `${prefix}${String(i).padStart(3, "0")}`,
    name: `${prefix} voice ${i}`,
    category: "premade",
    labels: { language: "en" },
    preview_url: `https://example.invalid/${prefix}${i}.mp3`,
  }));
}

module.exports = { createMockUpstream, makeVoices, VALID_SUBSCRIPTION };
