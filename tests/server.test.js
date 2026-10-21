"use strict";

/**
 * Server-side regression tests (T1 - T8).
 *
 * The real server.js runs as a child process; the ElevenLabs SDK inside it is
 * pointed at a local mock upstream through the `ELEVENLABS_BASE_URL` test
 * hook, so the real ElevenLabs API is never contacted and the real API key in
 * `.env` is never used.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { createMockUpstream, makeVoices } = require("./helpers/mock-upstream");
const { startServer, findFreePort, withApp, httpFetch } = require("./helpers/server-harness");

const VOICE_ID = "JBFqnCBsd6RMkjVDRZzb";

function postTts(baseUrl, body) {
  return httpFetch(`${baseUrl}/api/tts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("server: /api/tts voice settings", () => {
  it("tts: speed is forwarded to ElevenLabs for models that support it", async () => {
    await withApp({}, async ({ upstream, baseUrl }) => {
      const res = await postTts(baseUrl, {
        text: "The first move is what sets everything in motion.",
        voiceId: VOICE_ID,
        modelId: "eleven_turbo_v2_5",
        outputFormat: "mp3_44100_128",
        voiceSettings: { stability: 0.5, speed: 1.15 },
      });

      assert.equal(res.status, 200, `expected 200, got ${res.status}`);

      assert.equal(
        upstream.recorded.tts.length,
        1,
        "the app should have called the ElevenLabs text-to-speech endpoint exactly once",
      );
      const sent = upstream.recorded.tts[0].body;
      assert.ok(sent, "the upstream should have received a JSON body");
      assert.ok(sent.voice_settings, "the upstream body should carry voice_settings");
      assert.equal(
        sent.voice_settings.speed,
        1.15,
        "speed was silently dropped: voice_settings.speed must reach ElevenLabs",
      );
      assert.equal(sent.voice_settings.stability, 0.5);
    });
  });

  it("tts: speed is dropped for a model that does not support it", async () => {
    await withApp({}, async ({ upstream, baseUrl }) => {
      // The drop must be driven by the model's declared capability, so the
      // server has to publish it: the model must be flagged as not supporting
      // `speed`, and a `speed` spec must exist in the voice-settings range.
      const meta = await (await httpFetch(`${baseUrl}/api/meta`)).json();
      assert.equal(
        meta.models.eleven_multilingual_v2.supportsSpeed,
        false,
        "eleven_multilingual_v2 must be advertised as not supporting speed",
      );
      assert.ok(
        meta.voiceSettings.speed,
        "the server must publish a `speed` range (without it, speed is dropped for every model)",
      );

      const res = await postTts(baseUrl, {
        text: "Multilingual models reject speed upstream.",
        voiceId: VOICE_ID,
        modelId: "eleven_multilingual_v2",
        outputFormat: "mp3_44100_128",
        voiceSettings: { stability: 0.5, speed: 1.15 },
      });

      assert.equal(res.status, 200, `expected 200, got ${res.status}`);
      assert.equal(upstream.recorded.tts.length, 1);

      const sent = upstream.recorded.tts[0].body;
      assert.ok(sent.voice_settings, "the upstream body should carry voice_settings");
      assert.equal(
        Object.prototype.hasOwnProperty.call(sent.voice_settings, "speed"),
        false,
        "eleven_multilingual_v2 must not receive `speed`",
      );
      assert.equal(sent.voice_settings.stability, 0.5, "other settings still apply");
    });
  });

  it("tts: out-of-range voice settings are rejected with 400", async () => {
    await withApp({}, async ({ upstream, baseUrl }) => {
      const res = await postTts(baseUrl, {
        text: "Out of range speed.",
        voiceId: VOICE_ID,
        modelId: "eleven_turbo_v2_5",
        outputFormat: "mp3_44100_128",
        voiceSettings: { stability: 0.5, speed: 99 },
      });

      assert.equal(res.status, 400, `expected 400, got ${res.status}`);
      const body = await res.json();
      assert.ok(body.error, `expected an error message, got ${JSON.stringify(body)}`);
      assert.equal(
        upstream.recorded.tts.length,
        0,
        "an invalid request must never reach ElevenLabs",
      );
    });
  });
});

describe("server: /api/quota", () => {
  it("quota: the success payload is nested under `quota`", async () => {
    await withApp({}, async ({ baseUrl }) => {
      const res = await httpFetch(`${baseUrl}/api/quota`);
      assert.equal(res.status, 200, `expected 200, got ${res.status}`);

      const body = await res.json();
      assert.ok(
        body.quota && typeof body.quota === "object" && !Array.isArray(body.quota),
        `expected body.quota to be an object, got ${JSON.stringify(body)}`,
      );
      assert.equal(body.quota.tier, "free");
      assert.equal(body.quota.characterCount, 1234);
      assert.equal(body.quota.characterLimit, 10000);
      assert.equal(body.quota.nextResetUnix, 1735689600);
    });
  });

  it("quota: an upstream 401 is reported as a non-2xx with a null quota", async () => {
    await withApp({ subscriptionStatus: 401 }, async ({ baseUrl }) => {
      const res = await httpFetch(`${baseUrl}/api/quota`);
      assert.ok(
        res.status < 200 || res.status >= 300,
        `expected a non-2xx status, got ${res.status}`,
      );

      const body = await res.json();
      assert.ok(
        typeof body.kind === "string" && body.kind.length > 0,
        `expected a classification in body.kind, got ${JSON.stringify(body)}`,
      );
      assert.equal(body.quota, null, "a failed quota lookup must report quota: null");
      assert.ok(body.error, "expected an error message");
    });
  });

  it("quota: an upstream schema error is classified as `upstream`, not `network`", async () => {
    // A body that is missing the required subscription keys: the SDK raises a
    // ParseError, which means ElevenLabs answered but with an unexpected shape.
    await withApp(
      { subscriptionBody: { tier: "free" } },
      async ({ baseUrl }) => {
        const res = await httpFetch(`${baseUrl}/api/quota`);
        const body = await res.json();

        assert.equal(
          body.kind,
          "upstream",
          `expected kind "upstream", got ${JSON.stringify(body)}`,
        );
        assert.ok(
          !/Could not reach ElevenLabs/.test(body.error ?? ""),
          `a schema error must not be reported as a connectivity problem: ${body.error}`,
        );
      },
    );
  });
});

describe("server: /api/voices", () => {
  it("voices: every page is fetched, not just the first ten", async () => {
    const pageOne = makeVoices("alpha", 25);
    const pageTwo = makeVoices("beta", 7);

    await withApp(
      {
        voicePages: [{ voices: pageOne, hasMore: true, nextPageToken: "page-2-token" }],
        voicePageByToken: { "page-2-token": { voices: pageTwo, hasMore: false } },
      },
      async ({ upstream, baseUrl }) => {
        const res = await httpFetch(`${baseUrl}/api/voices`);
        assert.equal(res.status, 200, `expected 200, got ${res.status}`);

        const body = await res.json();
        assert.equal(
          body.voices.length,
          32,
          `expected all 32 voices (25 + 7), got ${body.voices.length}`,
        );
        const ids = new Set(body.voices.map((v) => v.id));
        assert.equal(ids.size, 32, "the returned voice ids should be unique");
        for (const voice of pageOne) assert.ok(ids.has(voice.voice_id), "page one voice missing");
        for (const voice of pageTwo) assert.ok(ids.has(voice.voice_id), "page two voice missing");

        // The app must ask for the maximum page size, then follow the token.
        assert.ok(
          upstream.recorded.voices.length >= 2,
          `expected at least two upstream voice requests, got ${upstream.recorded.voices.length}`,
        );
        assert.equal(
          upstream.recorded.voices[0].query.page_size,
          "100",
          `expected page_size=100 on the first request, got ${JSON.stringify(upstream.recorded.voices[0].query)}`,
        );
        const followUp = upstream.recorded.voices.slice(1).find((r) => r.query.next_page_token);
        assert.ok(
          followUp,
          `expected a follow-up request carrying next_page_token, got ${JSON.stringify(upstream.recorded.voices.map((r) => r.query))}`,
        );
        assert.equal(followUp.query.next_page_token, "page-2-token");
      },
    );
  });
});

describe("server: /api/health", () => {
  it("health: reports 200 and ok:true when the API key is configured", async () => {
    const upstream = createMockUpstream({});
    await upstream.listen();
    const port = await findFreePort();
    const server = startServer({
      port,
      env: { ELEVENLABS_BASE_URL: upstream.url, ELEVENLABS_API_KEY: "test" },
    });

    try {
      await server.waitReady();
      const res = await httpFetch(`${server.baseUrl}/api/health`);
      assert.equal(res.status, 200, `expected 200, got ${res.status}`);
      const body = await res.json();
      assert.equal(body.ok, true);
    } finally {
      await server.stop();
      await upstream.close();
    }
  });

  it("health: reports 503 and ok:false when no API key is configured", async () => {
    const upstream = createMockUpstream({});
    await upstream.listen();
    const port = await findFreePort();
    const server = startServer({
      port,
      env: {
        ELEVENLABS_BASE_URL: upstream.url,
        ELEVENLABS_API_KEY: undefined, // explicitly unset
      },
    });

    try {
      await server.waitReady();
      const res = await httpFetch(`${server.baseUrl}/api/health`);
      assert.equal(res.status, 503, `expected 503, got ${res.status}`);
      const body = await res.json();
      assert.equal(body.ok, false);
    } finally {
      await server.stop();
      await upstream.close();
    }
  });
});
