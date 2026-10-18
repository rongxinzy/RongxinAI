import fs from 'fs';

import os from 'os';
import path from 'path';

import { pathToFileURL } from 'url';

import { afterEach, describe, expect, it } from 'vitest';

import { resolveLocalPathCandidate } from './localPathResolver';

const tempBase = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-resolver-'));
const roots = [tempBase];

const makeFile = (relative: string): string => {
  const filePath = path.join(tempBase, relative);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, 'resolver fixture', 'utf-8');
  return filePath;
};

const makeDir = (relative: string): string => {
  const dirPath = path.join(tempBase, relative);
  fs.mkdirSync(dirPath, { recursive: true });
  return dirPath;
};

afterEach(() => {
  fs.rmSync(tempBase, { recursive: true, force: true });
  fs.mkdirSync(tempBase, { recursive: true });
});

describe('resolveLocalPathCandidate', () => {
  it('resolves absolute candidates inside allowed roots', async () => {
    const filePath = makeFile('absolute/report.html');
    await expect(resolveLocalPathCandidate(filePath, undefined, roots)).resolves.toBe(filePath);
  });

  it('resolves relative candidates against cwd', async () => {
    makeFile('workspace/notes/a.txt');
    await expect(
      resolveLocalPathCandidate('notes/a.txt', path.join(tempBase, 'workspace'), roots),
    ).resolves.toBe(path.join(tempBase, 'workspace', 'notes', 'a.txt'));
    await expect(
      resolveLocalPathCandidate('./notes/../notes/a.txt', path.join(tempBase, 'workspace'), roots),
    ).resolves.toBe(path.join(tempBase, 'workspace', 'notes', 'a.txt'));
  });

  it('resolves file URLs via fileURLToPath', async () => {
    const filePath = makeFile('url/销售简历.html');
    const fileUrl = pathToFileURL(filePath).href;
    await expect(resolveLocalPathCandidate(fileUrl, undefined, roots)).resolves.toBe(filePath);
  });

  it('returns null for directories', async () => {
    const dirPath = makeDir('dir-only');
    await expect(resolveLocalPathCandidate(dirPath, undefined, roots)).resolves.toBeNull();
  });

  it('returns null for missing files', async () => {
    await expect(
      resolveLocalPathCandidate(path.join(tempBase, 'missing.txt'), undefined, roots),
    ).resolves.toBeNull();
  });

  it('returns null outside allowed roots', async () => {
    const outside = path.join(os.tmpdir(), `outside-${Date.now()}-a.txt`);
    fs.writeFileSync(outside, 'x', 'utf-8');
    try {
      await expect(resolveLocalPathCandidate(outside, undefined, roots)).resolves.toBeNull();
    } finally {
      fs.rmSync(outside, { force: true });
    }
  });

  it('returns null for empty, oversized, NUL or newline candidates', async () => {
    await expect(resolveLocalPathCandidate('', undefined, roots)).resolves.toBeNull();
    await expect(resolveLocalPathCandidate('   ', undefined, roots)).resolves.toBeNull();
    await expect(resolveLocalPathCandidate('a'.repeat(2000), undefined, roots)).resolves.toBeNull();
    await expect(
      resolveLocalPathCandidate(`${tempBase}/a\0b.txt`, undefined, roots),
    ).resolves.toBeNull();
    await expect(
      resolveLocalPathCandidate(`${tempBase}/a\nb.txt`, undefined, roots),
    ).resolves.toBeNull();
  });

  it('returns null for non-file schemes (http/https)', async () => {
    await expect(
      resolveLocalPathCandidate('https://example.com/a.html', undefined, roots),
    ).resolves.toBeNull();
    await expect(
      resolveLocalPathCandidate('mailto:someone@example.com', undefined, roots),
    ).resolves.toBeNull();
  });

  it('normalizes windows-style backslash candidates where applicable', async () => {
    const filePath = makeFile('windows/a.txt');
    const backslashCandidate = filePath.replace(/\//g, '\\');
    // On POSIX hosts backslashes are valid filename characters, so only the
    // plain forward-slash form must resolve; the backslash form must not
    // resolve to a different existing file.
    const posixResult = await resolveLocalPathCandidate(backslashCandidate, undefined, roots);
    if (process.platform === 'win32') {
      expect(posixResult).toBe(filePath);
    } else {
      expect(posixResult === null || posixResult === filePath).toBe(true);
    }
    await expect(resolveLocalPathCandidate(filePath, undefined, roots)).resolves.toBe(filePath);
  });
});
