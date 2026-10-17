#!/usr/bin/env node
'use strict';

// Report-only measurement of the staged llama.cpp runtime
// (resources/llamacpp-bundled). Prints one `[measure]` line plus the full file
// list with sizes, and appends both to the GitHub job summary. It never fails
// on size: limits for the new cpu/cuda editions are added later from these
// measured values (measured + explicit margin).

const fs = require('node:fs');
const path = require('node:path');

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
  const line = `[measure] llamacpp-bundled ${JSON.stringify({ target, launched, files: files.length, bytes })}`;
  const table = files.map(file => `${file.bytes}\t${file.path}`).join('\n');
  return { files, bytes, line, table };
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

module.exports = { listFiles, measure };
