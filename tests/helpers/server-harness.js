"use strict";

/**
 * Starts the real server.js in a child process so the HTTP behaviour can be
 * asserted end to end, against a mock ElevenLabs upstream.
 *
 * The child never loads `.env`: the environment is passed explicitly, so the
 * real API key is never used and the real ElevenLabs API is never contacted.
 */

const { spawn } = require("node:child_process");
const net = require("node:net");
const path = require("node:path");

const { findRepoRoot, REPO_ROOT } = require("./paths");

const SERVER_ENTRY = path.join(REPO_ROOT, "server.js");

/**
 * Port allocation.
 *
 * Two rules make the server tests reliable:
 *
 * 1. A port is never reused. Node's global fetch pools keep-alive connections
 *    per origin, so a request to a recycled port can travel over a socket
 *    that still belongs to the previous server — the request would silently
 *    hit the wrong process. A unique port per server instance gives every
 *    server its own origin.
 * 2. Each test *file* gets its own port range. `node --test` runs test files
 *    in parallel, and two files probing the same port can both conclude it is
 *    free. The range is derived from the process id, which differs per file.
 */
const PORT_RANGE_START = 20000 + (process.pid % 10000) * 4;
let nextPort = PORT_RANGE_START;

/** First free port at or after `start`. */
function isPortFree(port) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once("error", () => resolve(false));
    probe.once("listening", () => probe.close(() => resolve(true)));
    probe.listen(port, "127.0.0.1");
  });
}

/**
 * Reserves a port that no other server in this process will use.
 *
 * The free-port probe is a safety net for ports left over by an earlier run;
 * the counter is what actually prevents two servers in the same run from
 * picking the same port.
 */
async function findFreePort(start = PORT_RANGE_START) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const port = start + attempt;
    if (port >= nextPort) nextPort = port + 1;
    if (await isPortFree(port)) return port;
  }
  throw new Error(`no free port found between ${start} and ${start + 200}`);
}

/**
 * A fetch that does not leave a pooled keep-alive socket behind.
 *
 * `Connection: close` makes the server close the socket after the response,
 * so its graceful shutdown is not delayed by an idle connection and no socket
 * survives into the next test.
 *
 * The real `fetch` is captured at module load, so a test that stubs
 * `globalThis.fetch` cannot make this helper call itself.
 */
const realFetch = globalThis.fetch.bind(globalThis);

function httpFetch(url, init = {}) {
  const headers = { ...(init.headers ?? {}), connection: "close" };
  return realFetch(url, { ...init, headers });
}

/**
 * Spawns server.js.
 * @param {{port: number, env?: Record<string, string|undefined>}} options
 */
function startServer({ port, env = {} }) {
  const childEnv = {
    ...process.env,
    PORT: String(port),
    // Never inherit a real key: the dummy is what the mock upstream expects.
    ELEVENLABS_API_KEY: undefined,
    ...env,
  };

  const child = spawn(process.execPath, [SERVER_ENTRY], {
    cwd: REPO_ROOT,
    env: childEnv,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const stdout = [];
  const stderr = [];
  child.stdout.on("data", (chunk) => stdout.push(chunk.toString()));
  child.stderr.on("data", (chunk) => stderr.push(chunk.toString()));

  let exited = false;
  let exitInfo = null;
  child.on("exit", (code, signal) => {
    exited = true;
    exitInfo = { code, signal };
  });

  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    child,
    baseUrl,
    port,
    stdout: () => stdout.join(""),
    stderr: () => stderr.join(""),
    /**
     * Waits until THIS child is serving on the port.
     *
     * Readiness is tied to the child's own "listening on" log line, not just
     * to "something answers on that port": `node --test` runs test files in
     * parallel, so a sibling file's server can win the port and answer while
     * this child is still dying with EADDRINUSE. Waiting for the log line
     * makes that race detectable instead of silently testing the wrong
     * server.
     */
    async waitReady(timeoutMs = 15000) {
      const deadline = Date.now() + timeoutMs;
      const readyMarker = `listening on http://localhost:${port}`;
      while (Date.now() < deadline) {
        if (exited) {
          throw new Error(
            `server.js exited early (code=${exitInfo?.code} signal=${exitInfo?.signal})\n` +
              `stdout:\n${stdout.join("")}\nstderr:\n${stderr.join("")}`,
          );
        }
        if (stdout.join("").includes(readyMarker)) {
          // The child owns the port; make sure it really answers.
          await httpFetch(`${baseUrl}/api/health`);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      throw new Error(
        `server.js did not become ready on ${baseUrl}\nstdout:\n${stdout.join("")}\nstderr:\n${stderr.join("")}`,
      );
    },
    /** Stops the child; always resolves so `finally` blocks cannot hang. */
    stop() {
      return new Promise((resolve) => {
        if (exited) return resolve();
        let settled = false;
        const done = () => {
          if (settled) return;
          settled = true;
          resolve();
        };
        child.once("exit", done);
        child.kill("SIGTERM");
        // Escalate if the child ignores SIGTERM, and never leave the promise
        // pending — a stuck child must not hang the test run.
        setTimeout(() => {
          if (!exited) child.kill("SIGKILL");
          done();
        }, 3000).unref?.();
      });
    },
  };
}

/**
 * Convenience wrapper: boots a mock upstream + the app, runs `fn`, and always
 * tears both down again (even when the test throws).
 *
 * The port is re-picked and the server restarted if the child loses a race
 * for the port against another test file (node --test runs files in parallel).
 */
async function withServer({ upstreamOptions = {}, env = {} } = {}, fn) {
  const { createMockUpstream } = require("./mock-upstream");
  const upstream = createMockUpstream(upstreamOptions);
  await upstream.listen();

  try {
    let lastError = null;
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const port = await findFreePort();
      const server = startServer({
        port,
        env: { ELEVENLABS_BASE_URL: upstream.url, ELEVENLABS_API_KEY: "test", ...env },
      });

      try {
        await server.waitReady();
        return await fn({ upstream, server, baseUrl: server.baseUrl });
      } catch (err) {
        lastError = err;
        // Only a lost race for the port is retried. A crash for any other
        // reason is a real test failure and must be reported as such.
        const lostPortRace = /EADDRINUSE/.test(server.stderr() ?? "");
        if (!lostPortRace) throw err;
      } finally {
        await server.stop();
      }
    }
    throw lastError ?? new Error("could not start the server on a free port");
  } finally {
    await upstream.close();
  }
}

/**
 * Like withServer, but takes the mock upstream's options positionally and
 * uses the standard test key. This is the form the test files use.
 */
async function withApp(upstreamOptions, fn) {
  return withServer({ upstreamOptions }, fn);
}

module.exports = {
  startServer,
  findFreePort,
  withServer,
  withApp,
  httpFetch,
  REPO_ROOT,
  SERVER_ENTRY,
};
