"use strict";

/**
 * Marks the compiled `build/` directory as CommonJS.
 *
 * The repository's package.json declares `"type": "module"`, so Node treats
 * every `.js` file under the repo root as ESM — including the CommonJS that
 * `tsc -p tsconfig.test.json` emits. Dropping a `package.json` with
 * `"type": "commonjs"` into build/ gives the compiled output its own module
 * scope, so `require()` and `node --test` work on it.
 *
 * tsc empties outDir on every run, so this has to run after each compile.
 */

const fs = require("node:fs");
const path = require("node:path");

const BUILD_DIR = path.resolve(__dirname, "..", "build");

fs.mkdirSync(BUILD_DIR, { recursive: true });
fs.writeFileSync(
  path.join(BUILD_DIR, "package.json"),
  `${JSON.stringify({ type: "commonjs" }, null, 2)}\n`,
);
