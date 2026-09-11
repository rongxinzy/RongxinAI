/**
 * Packaged-app smoke for the SoL-Pi vendor loader. Run INSIDE the packaged
 * Electron binary (asar fs patches required):
 *
 *   <app>/Contents/MacOS/<executable> scripts/ci/solpi-packaged-smoke.cjs <app.asar>
 *
 * Exercises the compiled loader module from the packaged archive: the vendor
 * entry must resolve inside the archive (never a source checkout), jiti must
 * load the vendored TS graph against the archive's node_modules, and the
 * conservative profile must initialize the vendored extension factory.
 */
'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');

const asarRoot = process.argv[2];
if (!asarRoot) {
  console.error('Usage: electron solpi-packaged-smoke.cjs <path-to-app.asar>');
  process.exit(2);
}

const fail = message => {
  console.error(`[SolPiPackagedSmoke] FAIL: ${message}`);
  process.exit(1);
};

(async () => {
  const { conservativeSolPiConfig } = require(
    path.join(asarRoot, 'dist-electron', 'main', 'libs', 'solPi', 'solPiProfile.js'),
  );
  const vendorModule = require(
    path.join(asarRoot, 'dist-electron', 'main', 'libs', 'solPi', 'solPiVendor.js'),
  );

  const entry = vendorModule.resolveSolPiVendorEntry();
  if (!entry.startsWith(asarRoot + path.sep)) {
    fail(`vendor entry resolved outside the archive: ${entry}`);
  }
  if (!entry.endsWith(path.join('solpi-vendor', 'sol-pi', 'index.ts'))) {
    fail(`unexpected vendor entry: ${entry}`);
  }

  const vendor = await vendorModule.loadSolPiVendor();
  if (typeof vendor.createSolPiExtension !== 'function') {
    fail('vendor entry did not export the extension factory');
  }

  // Conservative extension initialization on a recording extension API.
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

  // Execute a real fused write+then_run inside the packaged archive: the
  // vendored tools must mutate the file and run the embedded command with the
  // archive's own runtime copies.
  const { mkdtempSync, readFileSync } = require('node:fs');
  const os = require('node:os');
  const workspace = mkdtempSync(path.join(os.tmpdir(), 'solpi-packaged-smoke-'));
  const fusedFile = path.join(workspace, 'fused.txt');
  const ctx = {
    cwd: workspace,
    sessionManager: {
      getSessionDir: () => workspace,
      getSessionId: () => 'solpi-packaged-smoke',
      getSessionFile: () => null,
    },
  };
  const write = registrations.tools.get('write');
  const fused = await write.execute(
    'smoke-fused-1',
    { path: fusedFile, content: 'PACKAGED-SOLPI\n', then_run: { command: 'wc -c < fused.txt' } },
    undefined,
    undefined,
    ctx,
  );
  const fusedText = fused.content.map(block => block.text ?? '').join('\n');
  if (!fusedText.includes('[then_run:succeeded]')) {
    fail(`fused then_run did not succeed in the packaged app: ${fusedText}`);
  }
  if (readFileSync(fusedFile, 'utf8') !== 'PACKAGED-SOLPI\n') {
    fail('fused write did not produce the expected file content');
  }

  console.log(
    `[SolPiPackagedSmoke] OK entry=${entry} tools=${toolNames.join(',')} fused=${fusedText
      .split('\n')
      .filter(line => line.includes('then_run'))
      .join('|')}`,
  );
  process.exit(0);
})().catch(error => {
  fail(error && error.stack ? error.stack : String(error));
});
