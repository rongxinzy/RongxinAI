/**
 * Regression gate for the SoL-Pi jiti packaging wiring.
 *
 * Two modes:
 *
 *   node scripts/ci/solpi-bundle-jiti-gate.cjs --static <dist-electron/main.js>
 *
 *     Plain Node (no Electron). Static assertions on the built main bundle;
 *     wired into the electron-verify CI workflow right after the build step.
 *
 *   <app>/Contents/MacOS/<executable> scripts/ci/solpi-bundle-jiti-gate.cjs <app.asar>
 *
 *     Run INSIDE the packaged Electron binary (asar fs patches required), like
 *     solpi-packaged-smoke.cjs. Runs the same static assertions against the
 *     packaged bundle, then exercises the externalized jiti wiring with a
 *     forced cold cache.
 *
 * What the static assertions detect (verified against the real pre-fix and
 * post-fix bundles emitted by `npm run build`): when jiti is NOT in
 * ELECTRON_MAIN_EXTERNALS, vite/rolldown inlines the ESM wrapper
 * (jiti/lib/jiti.mjs) whose lazy transform path survives as
 *
 *   createRequire(require("url").pathToFileURL(__filename).href)("../dist/babel.cjs")
 *
 * The quoted literal resolves relative to the bundle file, i.e.
 * <asar>/dist/babel.cjs, which does not exist in packaged layouts
 * (MODULE_NOT_FOUND; piRuntimeAdapter then silently disables SoL-Pi). After
 * externalization the bundle instead emits a plain require("jiti") and loads
 * the archive's own node_modules/jiti (lib/jiti.cjs via the package exports
 * "require" condition), whose babel helper resolution stays anchored inside
 * the package.
 *
 * Fingerprint choice: the gate fails on the quoted string literal
 * ../dist/babel.cjs (single quotes, double quotes, or backticks, enforced
 * with a backreference). Bundler region comments such as
 * `//#region node_modules/jiti/dist/babel.cjs` legitimately survive bundling
 * and even remain in the post-fix bundle; they contain `dist/babel.cjs`
 * without the `../` prefix and without surrounding quotes, so matching only
 * the quoted `../dist/babel.cjs` literal reliably distinguishes the
 * executable lazy-require path from comments. Path concatenation
 * ('..' + '/dist/babel.cjs') and other minified spellings remain outside a
 * syntactic gate's reach — the packaged cold-cache mode below is the
 * execution-level backstop for those.
 *
 * The assertions are deliberately coupled to the externalization strategy: a
 * loader change (e.g. switching solPiVendor to 'jiti/static', whose inlined
 * copy statically embeds babel and works) removes require("jiti") from the
 * bundle and will fail this gate on purpose. Changing the loading strategy
 * means updating this gate in the same change.
 */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Electron forwards Chromium switches (e.g. --no-sandbox) into process.argv,
// shifting the script off position 1 — locate the gate arguments relative to
// this script's own argv entry instead of a fixed index (same handling as
// solpi-packaged-smoke.cjs).
const scriptArgumentIndex = process.argv.findIndex(
  argument => argument.endsWith('solpi-bundle-jiti-gate.cjs'),
);
const gateArguments =
  scriptArgumentIndex >= 0 ? process.argv.slice(scriptArgumentIndex + 1) : process.argv.slice(2);

const fail = message => {
  console.error(`[SolPiBundleJitiGate] FAIL: ${message}`);
  process.exit(1);
};

const usage = () => {
  console.error(
    'Usage:\n' +
      '  node solpi-bundle-jiti-gate.cjs --static <path-to-dist-electron/main.js>\n' +
      '  <packaged-electron> solpi-bundle-jiti-gate.cjs <path-to-app.asar>',
  );
  process.exit(2);
};

// Quoted lazy-require literal of the inlined jiti ESM wrapper (see header).
const INLINED_JITI_BABEL_FINGERPRINT = /(['"`])\.\.\/dist\/babel\.cjs\1/;
// Externalized jiti require as emitted by rolldown's CJS output.
const EXTERNALIZED_JITI_REQUIRE = /require\(\s*(['"])jiti\1\s*\)/;

function assertBundleExternalizesJiti(bundlePath) {
  if (!fs.existsSync(bundlePath)) {
    fail(`main bundle not found: ${bundlePath}`);
  }
  const source = fs.readFileSync(bundlePath, 'utf8');
  const fingerprint = source.match(INLINED_JITI_BABEL_FINGERPRINT);
  if (fingerprint) {
    fail(
      `main bundle inlines jiti's lazy babel transform (string literal ${fingerprint[0]}): ` +
        `the helper resolves relative to the bundle and breaks in packaged layouts - ` +
        `keep 'jiti' in ELECTRON_MAIN_EXTERNALS (${bundlePath})`,
    );
  }
  if (!EXTERNALIZED_JITI_REQUIRE.test(source)) {
    fail(
      `main bundle does not contain an externalized require of the jiti package - ` +
        `'jiti' must stay in ELECTRON_MAIN_EXTERNALS (${bundlePath})`,
    );
  }
}

if (gateArguments[0] === '--static') {
  if (!gateArguments[1]) usage();
  const bundlePath = path.resolve(gateArguments[1]);
  assertBundleExternalizesJiti(bundlePath);
  console.log(
    `[SolPiBundleJitiGate] OK static bundle=${bundlePath} externalized jiti require present, no inlined babel fingerprint`,
  );
  process.exit(0);
}

const asarRoot = gateArguments[0] ? path.resolve(gateArguments[0]) : null;
if (!asarRoot) usage();

(async () => {
  // 1. Same static assertions against the packaged main bundle.
  const bundlePath = path.join(asarRoot, 'dist-electron', 'main.js');
  assertBundleExternalizesJiti(bundlePath);

  // 2. Force a COLD jiti cache BEFORE any jiti use. jiti derives its fs cache
  // from path.join(os.tmpdir(), 'jiti') at createJiti time, and Node's
  // os.tmpdir() re-reads TMPDIR/TEMP/TMP from the environment on every call.
  // Pointing them at a fresh empty directory guarantees the babel transform
  // path actually executes instead of reusing warm compiled blobs — a warm
  // cache would mask exactly the MODULE_NOT_FOUND failure this gate guards.
  // The cache env flags are cleared so jiti's fs cache stays enabled
  // (disabled caches would weaken the cold-cache proof below).
  const coldTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'solpi-jiti-gate-cold-'));
  for (const variable of ['TMPDIR', 'TEMP', 'TMP']) process.env[variable] = coldTmp;
  delete process.env.JITI_CACHE;
  delete process.env.JITI_FS_CACHE;
  delete process.env.JITI_REBUILD_FS_CACHE;
  if (os.tmpdir() !== coldTmp) {
    fail(`temp dir redirect did not take effect: expected ${coldTmp}, got ${os.tmpdir()}`);
  }

  // 3. Runtime exercise of the externalized bundle wiring. This require picks
  // the same module (node_modules/jiti/lib/jiti.cjs via the package exports
  // "require" condition) that the bundle's externalized require('jiti')
  // resolves to, and the anchor filename equals the bundle's own __filename —
  // the identical wiring solPiVendor uses in production.
  const jitiPkg = require(path.join(asarRoot, 'node_modules', 'jiti'));
  if (typeof jitiPkg.createJiti !== 'function') {
    fail('archive jiti package did not export createJiti');
  }
  const jiti = jitiPkg.createJiti(bundlePath, { moduleCache: true });
  const vendor = await jiti.import(path.join(asarRoot, 'solpi-vendor', 'sol-pi', 'index.ts'));
  assert.equal(typeof vendor.createSolPiExtension, 'function', 'vendor entry factory missing');

  // The cold cache must actually have been used: a freshly populated jiti
  // cache under the redirected temp dir proves no warm cache was consulted.
  const coldCacheDir = path.join(coldTmp, 'jiti');
  if (!fs.existsSync(coldCacheDir) || fs.readdirSync(coldCacheDir).length === 0) {
    fail(`cold jiti cache was not populated under the redirected temp dir: ${coldCacheDir}`);
  }

  // 4. Conservative profile through the packaged module (same load path as
  // solpi-packaged-smoke.cjs).
  const { conservativeSolPiConfig } = require(
    path.join(asarRoot, 'dist-electron', 'main', 'libs', 'solPi', 'solPiProfile.js'),
  );
  const registrations = { events: [], tools: new Map() };
  const fakeApi = {
    on: (type, handler) => registrations.events.push({ type, handler }),
    registerTool: tool => registrations.tools.set(tool.name, tool),
  };
  const factory = vendor.createSolPiExtension(() => conservativeSolPiConfig());
  factory(fakeApi);
  const sessionStart = registrations.events.find(({ type }) => type === 'session_start');
  if (!sessionStart) fail('extension did not register a session_start hook');
  sessionStart.handler({ type: 'session_start' }, { cwd: process.cwd() });
  const toolNames = [...registrations.tools.keys()].sort();
  if (JSON.stringify(toolNames) !== JSON.stringify(['edit', 'obs_recall', 'write'])) {
    fail(`conservative profile registered unexpected tools: ${toolNames.join(', ')}`);
  }

  // 5. Execute a real fused write+then_run inside the cold temp dir workspace:
  // the vendored tools must transform through the cold jiti instance, mutate
  // the file, and run the embedded command.
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'solpi-jiti-gate-work-'));
  const fusedFile = path.join(workspace, 'fused.txt');
  const ctx = {
    cwd: workspace,
    sessionManager: {
      getSessionDir: () => workspace,
      getSessionId: () => 'solpi-jiti-gate',
      getSessionFile: () => null,
    },
  };
  const write = registrations.tools.get('write');
  const fused = await write.execute(
    'jiti-gate-fused-1',
    { path: fusedFile, content: 'JITI-GATE\n', then_run: { command: 'wc -c < fused.txt' } },
    undefined,
    undefined,
    ctx,
  );
  const fusedText = fused.content.map(block => block.text ?? '').join('\n');
  if (!fusedText.includes('[then_run:succeeded]')) {
    fail(`fused then_run did not succeed in the packaged app: ${fusedText}`);
  }
  if (fs.readFileSync(fusedFile, 'utf8') !== 'JITI-GATE\n') {
    fail('fused write did not produce the expected file content');
  }

  console.log(
    `[SolPiBundleJitiGate] OK bundle=${bundlePath} tools=${toolNames.join(',')} coldCache=${coldCacheDir} fused=${fusedText
      .split('\n')
      .filter(line => line.includes('then_run'))
      .join('|')}`,
  );
  process.exit(0);
})().catch(error => {
  fail(error && error.stack ? error.stack : String(error));
});
