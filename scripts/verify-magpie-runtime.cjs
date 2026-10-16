#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { parseArgs } = require('node:util');
const { TARGETS, verifyRuntime } = require('./magpie-runtime.cjs');

if (require.main === module) {
  try {
    const { values } = parseArgs({
      args: process.argv[2] === '--' ? process.argv.slice(3) : process.argv.slice(2),
      options: { target: { type: 'string' } },
    });
    const targets =
      values.target === 'all'
        ? Object.keys(TARGETS)
        : [values.target || `${process.platform}-${process.arch}`];
    for (const target of targets) {
      const manifest = verifyRuntime(path.join(__dirname, '..', 'resources', 'magpie'), target);
      console.log(`[magpie-verify] ${target} ${manifest.version} ${manifest.sha256}`);
    }
  } catch (error) {
    console.error(`[magpie-verify] ${error.message}`);
    process.exitCode = 1;
  }
}
