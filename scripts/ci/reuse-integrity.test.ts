import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';

const roots: string[] = [];
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'reuse-integrity-'));
  roots.push(root);
  const write = (name: string, value: string) => {
    mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    writeFileSync(path.join(root, name), value);
  };
  return { root, write };
}
afterEach(() => roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true })));
function run(root: string, script: string, args: string[]) {
  return spawnSync(process.execPath, [path.join(__dirname, script), ...args], {
    cwd: root,
    encoding: 'utf8',
  });
}

test('compiled runtime reuse rejects changed, added and removed files', () => {
  const { root, write } = fixture();
  write('runtime/bin/server', 'binary');
  expect(run(root, 'runtime-tree-integrity.cjs', ['seal', 'runtime']).status).toBe(0);
  expect(run(root, 'runtime-tree-integrity.cjs', ['verify', 'runtime']).status).toBe(0);
  write('runtime/bin/server', 'tampered');
  expect(run(root, 'runtime-tree-integrity.cjs', ['verify', 'runtime']).status).not.toBe(0);
  write('runtime/bin/server', 'binary');
  write('runtime/bin/injected.dll', 'injected');
  expect(run(root, 'runtime-tree-integrity.cjs', ['verify', 'runtime']).status).not.toBe(0);
  rmSync(path.join(root, 'runtime/bin/injected.dll'));
  rmSync(path.join(root, 'runtime/bin/server'));
  expect(run(root, 'runtime-tree-integrity.cjs', ['verify', 'runtime']).status).not.toBe(0);
});

test('compression reuse requires passing probes and the same archive, tool and policy', () => {
  const { root, write } = fixture();
  const components = 'build-tar/windows-components';
  const manifest = {
    components: [
      {
        key: 'skill-python',
        contentId: 'source',
        archive: 'skill-python.7z',
        archiveCompression: 'solid',
        archiveSha256: hash('archive'),
      },
    ],
  };
  write(`${components}/manifest.json`, JSON.stringify(manifest));
  write(`${components}/skill-python.7z`, 'archive');
  write('node_modules/7zip-bin/win/x64/7za.exe', 'compressor');
  write('scripts/ci/benchmark-skill-python-compression.ps1', 'policy');
  const reportPath = `${components}/skill-python-compression-benchmark.json`;
  write(
    reportPath,
    JSON.stringify({
      qualified: true,
      contentSha256Equal: true,
      pythonProbePassed: true,
      solidBytes: 7,
      savedBytes: 2 * 1024 * 1024,
      extractionRatio: 1.1,
    }),
  );
  const command = (action: string) => run(root, 'compression-qualification.cjs', [action]);
  expect(command('seal').status).toBe(0);
  expect(command('verify').status).toBe(0);
  write('node_modules/7zip-bin/win/x64/7za.exe', 'new compressor');
  expect(command('verify').status).not.toBe(0);
  write('node_modules/7zip-bin/win/x64/7za.exe', 'compressor');
  write('scripts/ci/benchmark-skill-python-compression.ps1', 'new policy');
  expect(command('verify').status).not.toBe(0);
  write('scripts/ci/benchmark-skill-python-compression.ps1', 'policy');
  const report = JSON.parse(readFileSync(path.join(root, reportPath), 'utf8'));
  write(reportPath, JSON.stringify({ ...report, pythonProbePassed: false }));
  expect(command('seal').status).not.toBe(0);
  write(reportPath, JSON.stringify(report));
  write(`${components}/skill-python.7z`, 'changed');
  manifest.components[0].archiveSha256 = hash('changed');
  write(`${components}/manifest.json`, JSON.stringify(manifest));
  expect(command('verify').status).not.toBe(0);
});
