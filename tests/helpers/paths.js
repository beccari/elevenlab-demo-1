"use strict";

const fs = require("node:fs");
const path = require("node:path");

/**
 * Walks up from this file until it finds the directory that holds server.js.
 * The helpers live at `tests/helpers/` in the source tree but at
 * `build/tests/helpers/` once compiled, so the depth is not fixed.
 */
function findRepoRoot() {
  let dir = __dirname;
  for (let i = 0; i < 6; i += 1) {
    if (fs.existsSync(path.join(dir, "server.js"))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error(`could not locate the repository root from ${__dirname}`);
}

const REPO_ROOT = findRepoRoot();

/** Reads a file from the repository, relative to its root. */
function readRepoFile(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

module.exports = { findRepoRoot, REPO_ROOT, readRepoFile };
