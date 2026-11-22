#!/usr/bin/env bun

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const npmLockfiles = [
  'SKILLs/presentation-studio/package-lock.json',
  'SKILLs/web-search/package-lock.json',
  'scripts/release/package-lock.json',
];
const emailLockfile = 'SKILLs/imap-smtp-email/bun.lock';

const pythonRequirements = [
  'SKILLs/code-safety-audit/requirements.txt',
  'SKILLs/database-inspector/requirements.txt',
  'SKILLs/pdf/requirements.txt',
  'SKILLs/programming-tutor/requirements.txt',
  'SKILLs/py-perf-analyzer/requirements.txt',
  'SKILLs/regression-insight/requirements.txt',
  'SKILLs/sql-tutor/requirements.txt',
  'SKILLs/xlsx/requirements.txt',
  'SKILLs/zhiyuan-expert-manager/requirements.txt',
];

// Keep this list deliberately small. A new registry, Git dependency, or URL
// dependency must be explicitly reviewed before it can enter a release.
const approvedNpmRegistries = new Set([
  'https://registry.npmjs.org',
  'https://registry.npmmirror.com',
]);

const violations = [];

function checkPackage(lockfile, packageName, resolved, integrity) {
  if (resolved) {
    try {
      const { origin } = new URL(resolved);
      if (!approvedNpmRegistries.has(origin)) {
        violations.push(`${lockfile}: ${packageName} resolves from unapproved registry ${origin}`);
      }
    } catch {
      violations.push(`${lockfile}: ${packageName} has a non-HTTPS package source`);
    }
  }
  if (!integrity) violations.push(`${lockfile}: ${packageName} is missing an integrity hash`);
}

for (const lockfile of npmLockfiles) {
  const raw = await readFile(resolve(lockfile), 'utf8');
  const lock = JSON.parse(raw);

  for (const [packagePath, entry] of Object.entries(lock.packages ?? {})) {
    if (!entry?.resolved) continue;
    checkPackage(lockfile, packagePath, entry.resolved, entry.integrity);
  }
}

const emailLock = Bun.JSONC.parse(await readFile(resolve(emailLockfile), 'utf8'));
for (const [name, [, resolved, , integrity]] of Object.entries(emailLock.packages)) {
  checkPackage(emailLockfile, name, resolved, integrity);
}

for (const requirementsFile of pythonRequirements) {
  const lines = (await readFile(resolve(requirementsFile), 'utf8')).split(/\r?\n/);

  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const hasUnapprovedSource =
      /^(?:-i|--index-url|--extra-index-url|--find-links|--trusted-host)\b/i.test(line) ||
      /^(?:git\+|https?:\/\/|file:|\.\.?[\\/])/i.test(line) ||
      /\s@\s(?:git\+|https?:\/\/|file:)/i.test(line);

    if (hasUnapprovedSource) {
      violations.push(
        `${requirementsFile}:${index + 1} introduces a non-default Python package source`,
      );
    }
  }
}

if (violations.length > 0) {
  console.error('Supply-chain input policy failed:');
  for (const violation of violations) console.error(`- ${violation}`);
  process.exit(1);
}

console.log(
  `Supply-chain input policy passed: ${npmLockfiles.length + 1} JavaScript lockfiles and ${pythonRequirements.length} Python requirement files checked.`,
);
