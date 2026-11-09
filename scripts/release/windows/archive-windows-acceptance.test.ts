import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import { archiveWindowsAcceptance } from './archive-windows-acceptance.mjs';

async function fixture(run: (root: string) => Promise<void>) {
  const root = await mkdtemp(path.join(tmpdir(), 'windows-acceptance-'));
  try {
    await writeFile(
      path.join(root, 'package.json'),
      JSON.stringify({ version: '1.2.3', zhiyuanUpdateVariant: 'cpu' }),
    );
    await writeFile(path.join(root, 'setup.exe'), 'final cpu installer');
    const installerSha256 = createHash('sha256').update('final cpu installer').digest('hex');
    for (const [directory, kind] of [
      ['shell-interactive', 'webview2-shell-interactive-acceptance'],
      ['shell-uninstall', 'webview2-native-uninstall-acceptance'],
    ]) {
      await mkdir(path.join(root, 'acceptance-diagnostics', directory), { recursive: true });
      await writeFile(
        path.join(root, 'acceptance-diagnostics', directory, 'report.json'),
        (directory === 'shell-uninstall' ? '\uFEFF' : '') +
          JSON.stringify({
            kind,
            passed: true,
            commit: 'a'.repeat(40),
            runId: '10',
            installerSha256,
          }),
      );
    }
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function archive(root: string, edition = 'cpu') {
  return archiveWindowsAcceptance({
    root,
    edition,
    version: '1.2.3',
    commit: 'a'.repeat(40),
    runId: '10',
    runAttempt: '1',
    installer: 'setup.exe',
    outputDirectory: `bundle-win32-x64-${edition}`,
  });
}

test('archives final installer identity and isolates diagnostics from later editions', async () => {
  await fixture(async root => {
    const identity = await archive(root);
    expect(identity.edition).toBe('cpu');
    expect(identity.runAttempt).toBe('1');
    const report = path.join(
      root,
      'bundle-win32-x64-cpu/acceptance-diagnostics/shell-interactive/report.json',
    );
    const archived = await readFile(report, 'utf8');
    await writeFile(path.join(root, 'acceptance-diagnostics/shell-interactive/report.json'), '{}');
    expect(await readFile(report, 'utf8')).toBe(archived);
    const saved = JSON.parse(
      await readFile(
        path.join(root, 'bundle-win32-x64-cpu/acceptance-diagnostics/edition.json'),
        'utf8',
      ),
    );
    expect(saved.installerSha256).toBe(identity.installerSha256);
    await expect(archive(root)).rejects.toThrow();
  });
});

test('rejects evidence from another edition or changed final installer bytes', async () => {
  await fixture(async root => {
    await expect(archive(root, 'cuda')).rejects.toThrow(/edition mismatch/);
    await writeFile(path.join(root, 'setup.exe'), 'changed final bytes');
    await expect(archive(root)).rejects.toThrow(/installer bytes mismatch/);
  });
});

for (const field of ['passed', 'commit', 'runId', 'installerSha256'] as const) {
  test(`rejects invalid uninstall evidence ${field}`, async () => {
    await fixture(async root => {
      const filename = path.join(root, 'acceptance-diagnostics/shell-uninstall/report.json');
      const report = JSON.parse((await readFile(filename, 'utf8')).replace(/^\uFEFF/, ''));
      report[field] = field === 'passed' ? false : 'different';
      await writeFile(filename, JSON.stringify(report));
      await expect(archive(root)).rejects.toThrow();
    });
  });
}
