#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const baselinePath = path.join(root, 'scripts/ci/source-line-baseline.json');
const { limit, caps } = JSON.parse(readFileSync(baselinePath, 'utf8'));

const sourcePattern = /\.(ts|tsx|js|jsx|mjs|cjs|py)$/i;
const skipPattern =
  /(?:^|\/)(vendor|generated)(?:\/|$)|\.lock$|^tests\/replay\/tapes\/|MCPs\/feishu\/skills\/lark-apps\/creative-design\/starter-components\//;

function lineCount(absolutePath) {
  const output = execFileSync('wc', ['-l', absolutePath], { encoding: 'utf8' }).trim();
  return Number(output.split(/\s+/)[0]);
}

const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' })
  .split('\0')
  .filter(Boolean);

const errors = [];
const capPaths = new Set(Object.keys(caps));

for (const relative of tracked) {
  if (!sourcePattern.test(relative) || skipPattern.test(relative)) continue;
  const absolute = path.join(root, relative);
  let lines;
  try {
    lines = lineCount(absolute);
  } catch {
    continue;
  }
  const cap = caps[relative];
  if (cap !== undefined) {
    if (lines < limit) {
      errors.push(
        `${relative}: ${lines} lines (below ${limit}); remove from source-line-baseline.json`,
      );
    } else if (lines > cap) {
      errors.push(`${relative}: ${lines} lines exceeds baseline cap ${cap}`);
    }
    capPaths.delete(relative);
    continue;
  }
  if (lines > limit) {
    errors.push(
      `${relative}: ${lines} lines exceeds ${limit} (new file; split or add baseline only by shrinking first)`,
    );
  }
}

for (const orphan of capPaths) {
  errors.push(`${orphan}: listed in baseline but not found in the repository`);
}

if (errors.length) {
  console.error('Source line limit check failed:\n');
  for (const message of errors) console.error(`  ${message}`);
  process.exit(1);
}

console.log(
  `Source line limit check passed (${Object.keys(caps).length} capped file(s), ${limit}-line limit for all other sources).`,
);
