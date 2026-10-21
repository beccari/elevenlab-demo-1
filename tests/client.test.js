"use strict";

/**
 * Client-side regression tests (T9 - T12).
 *
 * The TypeScript sources are compiled to CommonJS under build/client/src/ by
 * `tsc -p tsconfig.test.json`; these tests require the compiled output.
 */

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { readRepoFile } = require("./helpers/paths");
const { withApp, httpFetch } = require("./helpers/server-harness");

// Compiled client modules (CommonJS).
const { api } = require("../client/src/api.js");
const { ApiError } = require("../client/src/types.js");
const { settingsFromMeta } = require("../client/src/App.js");

/** Builds a minimal Response-like object for parseError(). */
function makeResponse(status, body, { jsonThrows = false } = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => {
      if (jsonThrows) throw new SyntaxError("Unexpected token < in JSON at position 0");
      return body;
    },
  };
}

describe("client: api.parseError", () => {
  it("parseError: extracts `error` into the message and `kind` into ApiError.kind", async () => {
    const res = makeResponse(401, { error: "Authentication failed (401).", kind: "auth" });

    // parseError is module-private, so drive it through api.quota() with a
    // stubbed global fetch.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => res;
    try {
      await assert.rejects(
        () => api.quota(),
        (error) => {
          assert.ok(error instanceof ApiError, `expected an ApiError, got ${error}`);
          assert.equal(error.message, "Authentication failed (401).");
          assert.equal(error.kind, "auth");
          assert.equal(error.status, 401);
          return true;
        },
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("parseError: keeps the HTTP status and the default message for a non-JSON body", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => makeResponse(500, null, { jsonThrows: true });
    try {
      await assert.rejects(
        () => api.quota(),
        (error) => {
          assert.ok(error instanceof ApiError, `expected an ApiError, got ${error}`);
          assert.equal(error.status, 500, "the HTTP status must be preserved");
          assert.equal(error.message, "Request failed (HTTP 500).", "the default message is used");
          assert.equal(error.kind, null, "no classification can be read from a non-JSON body");
          return true;
        },
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("parseError: surfaces the server's upstream classification for a malformed upstream body", async () => {
    // End to end: the real server talks to a mock upstream that answers with a
    // body that does not match the ElevenLabs schema. The server must classify
    // that as an `upstream` problem, and the client must carry the
    // classification through parseError() into ApiError.kind.
    await withApp({ subscriptionBody: { tier: "free" } }, async ({ baseUrl }) => {
      const originalFetch = globalThis.fetch;
      globalThis.fetch = (input, init) =>
        httpFetch(new URL(String(input), baseUrl), init);
      try {
        await assert.rejects(
          () => api.quota(),
          (error) => {
            assert.ok(error instanceof ApiError, `expected an ApiError, got ${error}`);
            assert.equal(
              error.kind,
              "upstream",
              `expected kind "upstream", got ${JSON.stringify(error.kind)}`,
            );
            assert.ok(
              !/Could not reach ElevenLabs/.test(error.message),
              `a schema error must not be reported as a connectivity problem: ${error.message}`,
            );
            return true;
          },
        );
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });
});

describe("client: ApiError", () => {
  it("ApiError: is an Error carrying `status` and `kind`", () => {
    const err = new ApiError("boom", 402, "quota");

    assert.ok(err instanceof Error, "ApiError must extend Error");
    assert.ok(err instanceof ApiError);
    assert.equal(err.message, "boom");
    assert.equal(err.status, 402);
    assert.equal(err.kind, "quota");
    assert.equal(err.name, "ApiError");
  });

  it("ApiError: `kind` defaults to null", () => {
    const err = new ApiError("boom", 500);

    assert.equal(err.kind, null);
    assert.equal(err.status, 500);
  });
});

describe("client: settingsFromMeta", () => {
  it("settingsFromMeta: maps the server's voiceSettings defaults into a SettingsState", () => {
    const spec = {
      stability: { min: 0, max: 1, step: 0.01, default: 0.3 },
      similarityBoost: { min: 0, max: 1, step: 0.01, default: 0.8 },
      style: { min: 0, max: 1, step: 0.01, default: 0.1 },
      useSpeakerBoost: { default: false },
      speed: { min: 0.7, max: 1.2, step: 0.05, default: 1 },
    };

    assert.deepEqual(settingsFromMeta(spec), {
      stability: 0.3,
      similarityBoost: 0.8,
      style: 0.1,
      useSpeakerBoost: false,
      speed: 1,
    });
  });
});

describe("client: quota degradation", () => {
  it("quota: a 401 from /api/quota rejects with an ApiError carrying the status and a kind", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      makeResponse(401, { error: "Authentication failed (401).", kind: "auth" });
    try {
      await assert.rejects(
        () => api.quota(),
        (error) => {
          assert.ok(error instanceof ApiError, `expected an ApiError, got ${error}`);
          assert.equal(error.status, 401);
          assert.ok(
            typeof error.kind === "string" && error.kind.length > 0,
            `expected a kind, got ${JSON.stringify(error.kind)}`,
          );
          return true;
        },
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("quota: App.tsx sets a quota warning when the quota request fails", () => {
    // The quota pill is rendered from `quotaWarning`; a rejected request must
    // set it, otherwise the top bar sits on its loading skeleton forever.
    const source = readRepoFile("client/src/App.tsx");

    const refreshQuota = source.slice(
      source.indexOf("const refreshQuota"),
      source.indexOf("const refreshQuota") + 800,
    );
    assert.ok(refreshQuota.length > 0, "could not locate refreshQuota in App.tsx");

    const catchBlock = refreshQuota.slice(refreshQuota.indexOf(".catch("));
    assert.ok(catchBlock.length > 0, "refreshQuota must have a .catch() handler");
    assert.match(
      catchBlock,
      /setQuotaWarning\(/,
      "the .catch() must call setQuotaWarning() so the UI shows the `quota n/a` pill",
    );
  });

  it("quota: the top bar shows a `quota n/a` pill when there is a warning but no quota", () => {
    const source = readRepoFile("client/src/components/TopBar.tsx");

    assert.match(
      source,
      /quotaWarning/,
      "TopBar must consider the quota warning",
    );
    assert.match(
      source,
      /quota n\/a/,
      'TopBar must render the "quota n/a" pill',
    );
    assert.match(
      source,
      /quota\s*\?\s*\(/,
      "the quota pill must only be used when a quota is present",
    );
  });
});
