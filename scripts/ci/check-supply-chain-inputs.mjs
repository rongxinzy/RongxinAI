#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const npmLockfiles = [
  'SKILLs/presentation-studio/package-lock.json',
  'SKILLs/web-search/package-lock.json',
  'scripts/release/package-lock.json',
]

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
]

// Keep this list deliberately small. A new registry, Git dependency, or URL
// dependency must be explicitly reviewed before it can enter a release.
const approvedNpmRegistries = new Set([
  'https://registry.npmjs.org',
  'https://registry.npmmirror.com',
])

const violations = []

for (const lockfile of npmLockfiles) {
  const raw = await readFile(resolve(lockfile), 'utf8')
  const lock = JSON.parse(raw)

  for (const [packagePath, entry] of Object.entries(lock.packages ?? {})) {
    if (!entry?.resolved) continue

    let origin
    try {
      origin = new URL(entry.resolved).origin
    } catch {
      violations.push(`${lockfile}: ${packagePath || '<root>'} has a non-HTTPS package source`)
      continue
    }

    if (!approvedNpmRegistries.has(origin)) {
      violations.push(`${lockfile}: ${packagePath || '<root>'} resolves from unapproved registry ${origin}`)
    }

    if (!entry.integrity) {
      violations.push(`${lockfile}: ${packagePath || '<root>'} is missing an integrity hash`)
    }
  }
}

for (const requirementsFile of pythonRequirements) {
  const lines = (await readFile(resolve(requirementsFile), 'utf8')).split(/\r?\n/)

  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue

    const hasUnapprovedSource =
      /^(?:-i|--index-url|--extra-index-url|--find-links|--trusted-host)\b/i.test(line) ||
      /^(?:git\+|https?:\/\/|file:|\.\.?[\\/])/i.test(line) ||
      /\s@\s(?:git\+|https?:\/\/|file:)/i.test(line)

    if (hasUnapprovedSource) {
      violations.push(`${requirementsFile}:${index + 1} introduces a non-default Python package source`)
    }
  }
}

if (violations.length > 0) {
  console.error('Supply-chain input policy failed:')
  for (const violation of violations) console.error(`- ${violation}`)
  process.exit(1)
}

console.log(`Supply-chain input policy passed: ${npmLockfiles.length} npm lockfiles and ${pythonRequirements.length} Python requirement files checked.`)
