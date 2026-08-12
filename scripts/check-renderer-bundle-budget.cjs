#!/usr/bin/env node
/*
 * Renderer bundle budget gate (issue #141).
 *
 * Run after a production renderer build (`VITE_SKIP_ELECTRON=1 npm run
 * build:vite`). Fails (exit 1) when `dist/` violates a budget:
 *
 *   - no *.map files may ship in the production bundle
 *   - preload graph (index.html script/preload refs + static imports) ≤ budget
 *   - startup graph (preload graph + the App/store chunks main.tsx imports
 *     at boot + static imports) ≤ budget
 *   - every single chunk in the startup graph ≤ budget
 *
 * Budgets track the current state and should only be tightened as the
 * remaining #141 phases land (target: startup ≤ 2.0 MiB raw / 700 KiB gzip).
 */

const fs = require('fs');
const path = require('path');

const BUDGETS = {
  maxSourcemaps: 0,
  preloadRawBytes: 1.0 * 1024 * 1024,
  startupRawBytes: 4.0 * 1024 * 1024,
  startupChunkRawBytes: 512 * 1024,
};

const distDir = process.argv[2] || 'dist';
const assetsDir = path.join(distDir, 'assets');

if (!fs.existsSync(assetsDir)) {
  console.error(`[bundle-budget] ${assetsDir} does not exist — run the renderer build first.`);
  process.exit(1);
}

const mib = bytes => `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
const kib = bytes => `${(bytes / 1024).toFixed(0)} KiB`;

const html = fs.readFileSync(path.join(distDir, 'index.html'), 'utf8');
const allFiles = fs.readdirSync(assetsDir);
const mapCount = allFiles.filter(file => file.endsWith('.map')).length;

const htmlRefs = [...html.matchAll(/(?:src|href)="[^"]*?([^"/]+\.js)"/g)].map(match => match[1]);

const staticImportRe = /(?:import|from)\s*"(\.\/[^"]+\.js)"/g;
const dynamicImportRe = /import\("(\.\/[^"]+\.js)"\)/g;

const walkStaticImports = seeds => {
  const seen = new Set();
  const queue = [...seeds];
  while (queue.length > 0) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const fullPath = path.join(assetsDir, file);
    if (!fs.existsSync(fullPath)) continue;
    const source = fs.readFileSync(fullPath, 'utf8');
    let match;
    while ((match = staticImportRe.exec(source))) {
      queue.push(path.basename(match[1]));
    }
  }
  return seen;
};

const sizeOf = files => {
  let total = 0;
  let largest = { file: null, size: 0 };
  for (const file of files) {
    const size = fs.statSync(path.join(assetsDir, file)).size;
    total += size;
    if (size > largest.size) largest = { file, size };
  }
  return { total, largest };
};

// Preload graph: everything index.html pulls in eagerly.
const preloadGraph = walkStaticImports(htmlRefs);

// Startup graph: preload graph plus the chunks main.tsx dynamically imports
// at boot (App, store) and their static dependencies.
const entrySource = fs.readFileSync(path.join(assetsDir, htmlRefs[0]), 'utf8');
const startupSeeds = new Set(htmlRefs);
let match;
while ((match = dynamicImportRe.exec(entrySource))) {
  startupSeeds.add(path.basename(match[1]));
}
const startupGraph = walkStaticImports([...startupSeeds]);

const preload = sizeOf(preloadGraph);
const startup = sizeOf(startupGraph);

console.log(`[bundle-budget] sourcemaps: ${mapCount}`);
console.log(`[bundle-budget] preload graph: ${preloadGraph.size} files, ${mib(preload.total)}`);
console.log(
  `[bundle-budget] startup graph: ${startupGraph.size} files, ${mib(startup.total)}; largest chunk ${startup.largest.file} ${kib(startup.largest.size)}`,
);

const failures = [];
if (mapCount > BUDGETS.maxSourcemaps) {
  failures.push(`sourcemaps in bundle: ${mapCount} > ${BUDGETS.maxSourcemaps}`);
}
if (preload.total > BUDGETS.preloadRawBytes) {
  failures.push(`preload graph ${mib(preload.total)} > ${mib(BUDGETS.preloadRawBytes)}`);
}
if (startup.total > BUDGETS.startupRawBytes) {
  failures.push(`startup graph ${mib(startup.total)} > ${mib(BUDGETS.startupRawBytes)}`);
}
if (startup.largest.size > BUDGETS.startupChunkRawBytes) {
  failures.push(
    `startup chunk ${startup.largest.file} ${kib(startup.largest.size)} > ${kib(BUDGETS.startupChunkRawBytes)}`,
  );
}

if (failures.length > 0) {
  console.error('[bundle-budget] BUDGET VIOLATION:');
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log('[bundle-budget] all budgets satisfied');
