#!/usr/bin/env node
/** Fail CI when a bundled Skill cannot be loaded by the in-app Skill manager. */
'use strict';

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const projectRoot = path.resolve(__dirname, '..');
const skillsRoot = path.join(projectRoot, 'SKILLs');
const allowedKeys = new Set(['name', 'description', 'license', 'allowed-tools', 'metadata']);
const namePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function walk(dir, entries = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (['node_modules', '.git', '.venv', '__pycache__'].includes(entry.name)) continue;
      walk(target, entries);
    }
    else if (entry.name === 'SKILL.md') entries.push(target);
  }
  return entries;
}

function frontmatter(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) throw new Error('missing YAML frontmatter');
  const parsed = yaml.load(match[1]);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('frontmatter must be a YAML object');
  }
  return parsed;
}

const failures = [];
for (const file of walk(skillsRoot).sort()) {
  try {
    const data = frontmatter(file);
    const invalid = Object.keys(data).filter(key => !allowedKeys.has(key));
    if (invalid.length) throw new Error(`unsupported key(s): ${invalid.join(', ')}`);
    if (typeof data.name !== 'string' || !namePattern.test(data.name)) {
      throw new Error('name must be lowercase hyphen-case');
    }
    if (typeof data.description !== 'string' || !data.description.trim()) {
      throw new Error('description is required');
    }
    if (data.metadata !== undefined && (typeof data.metadata !== 'object' || Array.isArray(data.metadata))) {
      throw new Error('metadata must be a YAML object');
    }
  } catch (error) {
    failures.push(`${path.relative(projectRoot, file)}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

if (failures.length) {
  console.error(`Invalid bundled Skill frontmatter (${failures.length}):\n${failures.join('\n')}`);
  process.exit(1);
}
console.log(`Validated ${walk(skillsRoot).length} bundled Skill frontmatter file(s).`);
