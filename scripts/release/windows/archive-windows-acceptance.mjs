import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export async function archiveWindowsAcceptance({
  edition,
  version,
  commit,
  runId,
  runAttempt,
  installer,
  outputDirectory,
  root = process.cwd(),
}) {
  assert(['lite', 'cpu', 'cuda'].includes(edition), 'Invalid Windows edition');
  assert.match(commit, /^[0-9a-f]{40}$/, 'Invalid source commit');
  assert.match(String(runId), /^[1-9][0-9]*$/, 'Invalid workflow run ID');
  assert.match(String(runAttempt), /^[1-9][0-9]*$/, 'Invalid workflow run attempt');
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.version, version, 'Acceptance version mismatch');
  assert.equal(pkg.zhiyuanUpdateVariant, edition, 'Acceptance edition mismatch');

  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path.resolve(root, installer))) hash.update(chunk);
  const installerSha256 = hash.digest('hex');
  const diagnostics = path.join(root, 'acceptance-diagnostics');
  for (const [directory, kind] of [
    ['shell-interactive', 'webview2-shell-interactive-acceptance'],
    ['shell-uninstall', 'webview2-native-uninstall-acceptance'],
  ]) {
    const text = await readFile(path.join(diagnostics, directory, 'report.json'), 'utf8');
    const report = JSON.parse(text.replace(/^\uFEFF/, ''));
    assert.equal(report.kind, kind, 'Wrong acceptance report kind');
    assert.equal(report.passed, true, 'Acceptance did not pass');
    assert.equal(report.commit, commit, 'Acceptance source mismatch');
    assert.equal(String(report.runId), String(runId), 'Acceptance workflow run mismatch');
    assert.equal(report.installerSha256, installerSha256, 'Acceptance installer bytes mismatch');
  }

  // An existing edition bundle is never silently overwritten with another run's evidence.
  const output = path.resolve(root, outputDirectory);
  await mkdir(output);
  await cp(diagnostics, path.join(output, 'acceptance-diagnostics'), { recursive: true });
  const identity = {
    edition,
    version,
    commit,
    runId: String(runId),
    runAttempt: String(runAttempt),
    installerSha256,
  };
  await writeFile(
    path.join(output, 'acceptance-diagnostics', 'edition.json'),
    `${JSON.stringify(identity, null, 2)}\n`,
  );
  return identity;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [edition, version, commit, runId, runAttempt, installer, outputDirectory] = process.argv.slice(2);
  await archiveWindowsAcceptance({
    edition,
    version,
    commit,
    runId,
    runAttempt,
    installer,
    outputDirectory,
  });
}
