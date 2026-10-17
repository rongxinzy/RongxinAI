#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const limitBytes = Number(process.env.LARGE_FILE_LIMIT_BYTES ?? 2 * 1024 * 1024);
const allowlistPath = path.join(root, 'scripts/ci/large-file-allowlist.txt');

function globToRegExp(pattern) {
  let re = '^';
  for (let index = 0; index < pattern.length; index += 1) {
    const char = pattern[index];
    if (char === '*' && pattern[index + 1] === '*') {
      index += 1;
      if (pattern[index + 1] === '/') {
        index += 1;
        re += '(?:.*/)?';
      } else {
        re += '.*';
      }
    } else if (char === '*') {
      re += '[^/]*';
    } else if (char === '?') {
      re += '[^/]';
    } else {
      re += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`${re}$`);
}

function globMatch(relativePath, pattern) {
  const normalized = relativePath.replace(/\\/g, '/');
  return globToRegExp(pattern).test(normalized);
}

const allowPatterns = readFileSync(allowlistPath, 'utf8')
  .split('\n')
  .map(line => line.replace(/#.*$/, '').trim())
  .filter(Boolean);

function isAllowed(relativePath) {
  return allowPatterns.some(pattern => globMatch(relativePath, pattern));
}

function changedPaths() {
  const base = process.env.PR_BASE_SHA;
  const head = process.env.PR_HEAD_SHA;
  if (base && head && /^[a-f0-9]{40}$/.test(base) && /^[a-f0-9]{40}$/.test(head)) {
    return execFileSync(
      'git',
      ['diff', '--name-only', '--diff-filter=AM', '-z', `${base}...${head}`],
      {
        cwd: root,
        encoding: 'utf8',
      },
    )
      .split('\0')
      .filter(Boolean);
  }
  if (process.env.GITHUB_EVENT_NAME === 'push') {
    return execFileSync(
      'git',
      ['show', '--name-only', '--pretty=format:', '-z', '--diff-filter=AM', 'HEAD'],
      {
        cwd: root,
        encoding: 'utf8',
      },
    )
      .split('\0')
      .filter(Boolean);
  }
  return execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean);
}

const violations = [];
for (const relative of changedPaths()) {
  const absolute = path.join(root, relative);
  let size;
  try {
    size = statSync(absolute).size;
  } catch {
    continue;
  }
  if (size <= limitBytes) continue;
  if (isAllowed(relative)) continue;
  violations.push({ relative, sizeMb: (size / (1024 * 1024)).toFixed(2) });
}

if (violations.length) {
  console.error(
    `Committed files exceed ${limitBytes} bytes (${Math.round(limitBytes / (1024 * 1024))} MiB) and are not allowlisted:`,
  );
  for (const entry of violations) {
    console.error(`  ${entry.relative} (${entry.sizeMb} MiB)`);
  }
  console.error(
    `Update ${path.relative(root, allowlistPath)} only for intentional shipped assets.`,
  );
  process.exit(1);
}

console.log(`Large-file check passed (${changedPaths().length} path(s) scanned).`);
