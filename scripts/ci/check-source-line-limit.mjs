#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASELINE_RELATIVE = 'scripts/ci/source-line-baseline.json';
const sourcePattern = /\.(ts|tsx|js|jsx|mjs|cjs|py)$/i;
const skipPattern =
  /(?:^|\/)(vendor|generated)(?:\/|$)|\.lock$|^tests\/replay\/tapes\/|MCPs\/feishu\/skills\/lark-apps\/creative-design\/starter-components\//;

export function isCheckedSource(relative) {
  return sourcePattern.test(relative) && !skipPattern.test(relative);
}

/**
 * Pure check. `lineCounts` maps tracked source paths to line counts.
 * `baseCaps` is the baseline of the base commit (null when unavailable): the
 * baseline may only ratchet down, so new entries, raised caps and a raised
 * limit are rejected.
 */
export function checkSourceLineLimit({ limit, caps }, lineCounts, base = null) {
  const errors = [];
  const capPaths = new Set(Object.keys(caps));

  for (const [relative, lines] of Object.entries(lineCounts)) {
    if (!isCheckedSource(relative)) continue;
    const cap = caps[relative];
    if (cap !== undefined) {
      if (lines <= limit) {
        errors.push(
          `${relative}: ${lines} lines (at or below ${limit}); remove from source-line-baseline.json`,
        );
      } else if (lines > cap) {
        errors.push(`${relative}: ${lines} lines exceeds baseline cap ${cap}`);
      }
      capPaths.delete(relative);
      continue;
    }
    if (lines > limit) {
      errors.push(
        `${relative}: ${lines} lines exceeds ${limit}; split the file (the baseline cannot grow)`,
      );
    }
  }

  for (const orphan of capPaths) {
    errors.push(`${orphan}: listed in baseline but not found in the repository`);
  }

  if (base) {
    if (limit > base.limit) {
      errors.push(`baseline limit raised from ${base.limit} to ${limit}`);
    }
    for (const [relative, cap] of Object.entries(caps)) {
      const baseCap = base.caps[relative];
      if (baseCap === undefined) {
        errors.push(`${relative}: new baseline entry (${cap}); the baseline may only shrink`);
      } else if (cap > baseCap) {
        errors.push(`${relative}: baseline cap raised from ${baseCap} to ${cap}`);
      }
    }
  }
  return errors;
}

function readBaseBaseline(root) {
  const candidates = [
    process.env.PR_BASE_SHA,
    process.env.SOURCE_LINE_BASE_REF,
    'origin/main',
  ].filter(Boolean);
  for (const ref of candidates) {
    try {
      const mergeBase = execFileSync('git', ['merge-base', ref, 'HEAD'], {
        cwd: root,
        encoding: 'utf8',
      }).trim();
      const text = execFileSync('git', ['show', `${mergeBase}:${BASELINE_RELATIVE}`], {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      return { ref, baseline: JSON.parse(text) };
    } catch {
      // try the next candidate
    }
  }
  return null;
}

function run(root) {
  const baseline = JSON.parse(readFileSync(path.join(root, BASELINE_RELATIVE), 'utf8'));
  const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
    .split('\0')
    .filter(Boolean);
  const lineCounts = {};
  for (const relative of tracked) {
    if (!isCheckedSource(relative)) continue;
    try {
      const output = execFileSync('wc', ['-l', path.join(root, relative)], {
        encoding: 'utf8',
      }).trim();
      lineCounts[relative] = Number(output.split(/\s+/)[0]);
    } catch {
      // deleted in the working tree
    }
  }
  const base = readBaseBaseline(root);
  if (!base) console.warn('Source line limit: base baseline unavailable; ratchet check skipped.');
  const errors = checkSourceLineLimit(baseline, lineCounts, base?.baseline ?? null);
  if (errors.length) {
    console.error('Source line limit check failed:\n');
    for (const message of errors) console.error(`  ${message}`);
    process.exit(1);
  }
  console.log(
    `Source line limit check passed (${Object.keys(baseline.caps).length} capped file(s), ${baseline.limit}-line limit for all other sources${base ? `, ratchet vs ${base.ref}` : ''}).`,
  );
}

const scriptPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (scriptPath === fileURLToPath(import.meta.url)) {
  run(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..'));
}
