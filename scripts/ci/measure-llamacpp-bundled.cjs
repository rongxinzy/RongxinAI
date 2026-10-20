#!/usr/bin/env node
'use strict';

// Size telemetry only (release policy, krli 2026-10-19).
// Runtime hash and launch acceptance remain separate required checks.

const fs = require('node:fs');
const path = require('node:path');

function resolveTargetLimit() {
  return null;
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
}

module.exports = { resolveTargetLimit, listFiles, measure };
