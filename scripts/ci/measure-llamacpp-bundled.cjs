#!/usr/bin/env node
'use strict';

// Measurement + size gate for the staged llama.cpp runtime
// (resources/llamacpp-bundled). Prints one `[measure]` line plus the full file
// list with sizes, and appends both to the GitHub job summary.
//
// cpu targets enforce limit = MEASURED staged bytes + margin. Measured in build
// run 39032801288 (main 51b62ed6, llama.cpp b9244); margin = ceil(3% of the
// measured bytes) in whole MiB. Limits change ONLY via a PR citing a new
// measured run; never bump them by a round number to make a build pass.
// cuda targets are publicly released with NO size limit (krli decision for the
// public cuda release): the NVIDIA runtime DLLs dominate and are not ours to
// shrink. They are still measured; integrity is pinned by sha256 elsewhere.

const fs = require('node:fs');
const path = require('node:path');

const MiB = 1024 * 1024;

const CPU_TARGET_BUDGETS = {
  'win32-x64-cpu': { measuredBytes: 152_004_077, marginBytes: 5 * MiB },
  'linux-x64-cpu': { measuredBytes: 138_108_759, marginBytes: 4 * MiB },
  'darwin-arm64-cpu': { measuredBytes: 25_936_788, marginBytes: 1 * MiB },
  'darwin-x64-cpu': { measuredBytes: 25_171_262, marginBytes: 1 * MiB },
};

/** Max staged bytes for a target, or null when uncapped (cuda, lite, unknown). */
function resolveTargetLimit(target) {
  const budget = CPU_TARGET_BUDGETS[target];
  return budget ? budget.measuredBytes + budget.marginBytes : null;
}

function assertWithinLimit(target, bytes) {
  const limit = resolveTargetLimit(target);
  if (limit != null && bytes > limit) {
    throw new Error(
      `llama.cpp bundled runtime for ${target} is ${bytes} bytes, over its ${limit} byte limit (measured ${CPU_TARGET_BUDGETS[target].measuredBytes} + margin)`,
    );
  }
  return limit;
}

function listFiles(root) {
  const files = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile())
        files.push({
          path: path.relative(root, full).split(path.sep).join('/'),
          bytes: fs.statSync(full).size,
        });
    }
  };
  walk(root);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

function measure(root, target, launched) {
  const files = listFiles(root);
  const bytes = files.reduce((sum, file) => sum + file.bytes, 0);
  const limit = resolveTargetLimit(target);
  const line = `[measure] llamacpp-bundled ${JSON.stringify({ target, launched, files: files.length, bytes, limit })}`;
  const table = files.map(file => `${file.bytes}\t${file.path}`).join('\n');
  return { files, bytes, limit, line, table };
}

if (require.main === module) {
  const [root = 'resources/llamacpp-bundled', target = 'unknown', launched = ''] =
    process.argv.slice(2);
  const result = measure(root, target, launched);
  console.log(result.line);
  console.log(result.table);
  if (process.env.GITHUB_STEP_SUMMARY) {
    fs.appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `\n### llama.cpp bundled runtime (${target})\n\n\`${result.line}\`\n\n\`\`\`\n${result.table}\n\`\`\`\n`,
    );
  }
  // Fail only after the measurement is logged, so an over-limit run still
  // reports the numbers a limits PR needs.
  assertWithinLimit(target, result.bytes);
}

module.exports = { CPU_TARGET_BUDGETS, resolveTargetLimit, assertWithinLimit, listFiles, measure };
