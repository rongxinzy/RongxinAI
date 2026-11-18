import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';

import { extractFile, listPackage, statFile } from '@electron/asar';

const script = fileURLToPath(import.meta.url);
const fixtures = path.resolve(import.meta.dirname, '../../tests/fixtures/document-reader');
const legacyCases = [
  ['legacy.doc', 'Fixture Document'],
  ['legacy.xls', '15.5%'],
];

async function assertInstalledWorker(archive) {
  assert.ok(process.versions.electron, 'The worker probe must run in packaged Electron');
  for (const [filename, expected] of legacyCases) {
    const worker = new Worker(path.join(archive, 'dist-electron', 'documentWorker.js'), {
      workerData: path.join(fixtures, filename),
    });
    try {
      const result = await new Promise((resolve, reject) => {
        worker.once('message', resolve);
        worker.once('error', reject);
        worker.once('exit', code => reject(new Error(`Document worker exited early (${code})`)));
      });
      assert.equal(result.error, undefined, `${filename} conversion failed: ${result.error}`);
      assert.ok(result.text.includes(expected), `Unexpected text in ${filename}`);
    } finally {
      await worker.terminate();
    }
  }
}

function assertInstalledPdf(resources, scratch) {
  const python = path.join(resources, 'skill-python', 'layers', 'shared', 'Scripts', 'python.exe');
  const pdf = path.join(fixtures, 'chinese-mixed.pdf');
  const helper = path.join(resources, 'ocr', 'pdf-pages.py');
  const options = {
    encoding: 'utf8',
    timeout: 30_000,
    windowsHide: true,
    env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
  };
  const extracted = JSON.parse(execFileSync(python, [helper, '--input', pdf, '--text'], options));
  assert.equal(extracted.pageCount, 2);
  assert.match(extracted.pages[0].text, /季度预算分析报告[\s\S]*剩余预算三千元/);
  assert.deepEqual(extracted.pages[1], { page: 2, text: '' });
  const rendered = JSON.parse(
    execFileSync(
      python,
      [helper, '--input', pdf, '--pages', '2', '--out', scratch, '--json'],
      options,
    ),
  );
  assert.deepEqual(
    rendered.pages.map(page => page.page),
    [2],
  );
  assert.ok(fs.statSync(rendered.pages[0].path).size > 0, 'Scan page was not rasterized');
  console.log('[InstalledDocumentReader] Chinese text and scan-page rasterization passed');

  const ocr = path.join(resources, 'ocr', 'ocr-image.ps1');
  const powershell = path.join(
    process.env.SystemRoot,
    'System32',
    'WindowsPowerShell',
    'v1.0',
    'powershell.exe',
  );
  const runOcr = args =>
    JSON.parse(
      execFileSync(
        powershell,
        [
          '-NoProfile',
          '-NonInteractive',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          ocr,
          '-Lang',
          'en-US',
          '-Json',
          ...args,
        ],
        options,
      ).trim(),
    );
  if (runOcr(['-Status']).ready) {
    const recognized = runOcr(['-Path', rendered.pages[0].path]);
    assert.match(
      recognized.results[0].lines.map(line => line.text).join(' '),
      /SCANNED\s+RECEIPT\s+2468/i,
    );
    console.log('[InstalledDocumentReader] Windows OCR recognized the scanned page');
  } else {
    console.log(
      '[InstalledDocumentReader] Windows OCR recognition skipped: en-US OCR is unavailable on this runner',
    );
  }
}

if (process.argv[2] === '--worker') {
  await assertInstalledWorker(process.argv[3]);
  fs.writeFileSync(process.argv[4], 'passed');
} else {
  const executable = path.resolve(process.argv[2]);
  const resources = path.join(path.dirname(executable), 'resources');
  const archive = path.join(resources, 'app.asar');
  const entries = listPackage(archive);
  assert.ok(
    !entries.some(entry => /[\\/]@firecrawl[\\/]anydoc(?:[\\/]|-win32-)/.test(entry)),
    'AnyDoc native package was installed',
  );
  const main = extractFile(archive, 'dist-electron/main.js').toString('utf8');
  assert.doesNotMatch(main, /\brequire\s*\(\s*['"]@firecrawl\/anydoc/);
  assert.ok(statFile(archive, 'node_modules/@firecrawl/anydoc-wasm/anydoc_wasm_bg.wasm').size > 0);
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-installed-reader-'));
  try {
    const marker = path.join(scratch, 'worker-result');
    execFileSync(executable, [script, '--worker', archive, marker], {
      timeout: 45_000,
      windowsHide: true,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    });
    assert.equal(fs.readFileSync(marker, 'utf8'), 'passed');
    console.log('[InstalledDocumentReader] Installed WASM worker read legacy DOC and XLS');
    assertInstalledPdf(resources, scratch);
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}
