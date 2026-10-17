#!/usr/bin/env bun
/**
 * Print sorted vitest it/test/describe titles from given files (one per line).
 * Usage: bun scripts/ci/export-vitest-case-names.mjs path/to/a.test.ts ...
 */
import fs from 'fs';

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('Usage: bun scripts/ci/export-vitest-case-names.mjs <test-files...>');
  process.exit(1);
}

const titlePattern = /\b(?:it|test|describe)\(\s*(['"`])((?:\\.|(?!\1)[^\\])*?)\1/g;

for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  let match;
  while ((match = titlePattern.exec(source)) !== null) {
    console.log(match[2].replace(/\\(['"`])/g, '$1'));
  }
}
