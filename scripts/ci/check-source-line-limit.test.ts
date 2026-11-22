import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { checkSourceLineLimit } from './check-source-line-limit.mjs';

const base = { limit: 1000, caps: { 'src/big.ts': 1500 } };

describe('checkSourceLineLimit', () => {
  test('passes when files are under the limit or within their cap', () => {
    expect(checkSourceLineLimit(base, { 'src/big.ts': 1400, 'src/a.ts': 1000 }, base)).toEqual([]);
  });

  test('fails a new file over the limit', () => {
    const errors = checkSourceLineLimit(base, { 'src/big.ts': 1500, 'src/new.ts': 1001 }, base);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('src/new.ts');
  });

  test('fails a capped file that grows past its cap', () => {
    expect(checkSourceLineLimit(base, { 'src/big.ts': 1501 }, base)[0]).toContain(
      'exceeds baseline cap',
    );
  });

  test('requires removing the entry once a file is at or under the limit', () => {
    expect(checkSourceLineLimit(base, { 'src/big.ts': 1000 }, base)[0]).toContain('remove from');
  });

  test('fails a raised cap even if the file fits it', () => {
    const head = { limit: 1000, caps: { 'src/big.ts': 1600 } };
    expect(checkSourceLineLimit(head, { 'src/big.ts': 1550 }, base)[0]).toContain('cap raised');
  });

  test('fails a new baseline entry', () => {
    const head = { limit: 1000, caps: { 'src/big.ts': 1500, 'src/new.ts': 1200 } };
    const errors = checkSourceLineLimit(head, { 'src/big.ts': 1500, 'src/new.ts': 1200 }, base);
    expect(errors).toEqual(['src/new.ts: new baseline entry (1200); the baseline may only shrink']);
  });

  test('fails a raised limit', () => {
    const head = { limit: 1200, caps: {} };
    expect(checkSourceLineLimit(head, {}, base)).toContain(
      'baseline limit raised from 1000 to 1200',
    );
  });

  test('allows lowering a cap and ignores vendored or non-source files', () => {
    const head = { limit: 1000, caps: { 'src/big.ts': 1200 } };
    expect(
      checkSourceLineLimit(
        head,
        { 'src/big.ts': 1100, 'src/vendor/x.ts': 5000, 'README.md': 4000 },
        base,
      ),
    ).toEqual([]);
  });

  test('fails orphaned baseline entries', () => {
    expect(checkSourceLineLimit(base, {}, base)[0]).toContain('not found');
  });
});

describe('source line limit command', () => {
  const scriptPath = 'scripts/ci/check-source-line-limit.mjs';
  const baselinePath = 'scripts/ci/source-line-baseline.json';
  let root: string;

  function git(...args: string[]) {
    execFileSync('git', args, { cwd: root, stdio: 'pipe' });
  }

  function runCheck() {
    return spawnSync(process.execPath, [scriptPath], {
      cwd: root,
      encoding: 'utf8',
      env: { ...process.env, PR_BASE_SHA: 'HEAD' },
    });
  }

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'source-line-limit-'));
    mkdirSync(path.join(root, 'scripts/ci'), { recursive: true });
    copyFileSync(
      new URL('./check-source-line-limit.mjs', import.meta.url),
      path.join(root, scriptPath),
    );
    writeFileSync(path.join(root, baselinePath), JSON.stringify({ limit: 1, caps: {} }));
    git('init', '-q');
    git('add', baselinePath);
    git(
      '-c',
      'user.name=Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      '-c',
      'commit.gpgsign=false',
      'commit',
      '-qm',
      'baseline',
    );
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test('counts only newline bytes and skips sources removed from the working tree', () => {
    const file = path.join(root, 'lines.ts');
    writeFileSync(file, 'first\r\nlast');
    writeFileSync(path.join(root, 'empty.ts'), '');
    writeFileSync(path.join(root, 'removed.ts'), 'first\nsecond\n');
    git('add', 'lines.ts', 'empty.ts', 'removed.ts');
    rmSync(path.join(root, 'removed.ts'));

    const withinLimit = runCheck();
    expect(withinLimit.status).toBe(0);
    expect(withinLimit.stdout).toContain('ratchet vs HEAD');
    expect(withinLimit.stderr).toBe('');

    writeFileSync(file, 'first\r\nlast\n');
    const overLimit = runCheck();
    expect(overLimit.status).toBe(1);
    expect(overLimit.stderr).toContain('lines.ts: 2 lines exceeds 1');
  });

  test.skipIf(process.platform === 'win32')(
    'follows source symlinks and reports failed reads',
    () => {
      const target = path.join(root, 'target');
      writeFileSync(target, 'first\nsecond\n');
      symlinkSync('target', path.join(root, 'linked.ts'));
      git('add', 'linked.ts');

      const readable = runCheck();
      expect(readable.status).toBe(1);
      expect(readable.stderr).toContain('linked.ts: 2 lines exceeds 1');

      rmSync(target);
      const dangling = runCheck();
      expect(dangling.status).toBe(1);
      expect(dangling.stderr).toMatch(/ENOENT.*linked\.ts/);
    },
  );
});
