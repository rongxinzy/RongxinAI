import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { afterEach, expect, test } from 'vitest';

const { validateAgentMd, ValidationResult } = require('./validate_expert.js') as {
  validateAgentMd: (mdPath: string, result: { errors: string[]; warnings: string[] }) => void;
  ValidationResult: new () => { errors: string[]; warnings: string[] };
};

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

function writeAgent(body: string): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-expert-validator-'));
  temporaryDirectories.push(directory);
  const agentPath = path.join(directory, 'test-expert.md');
  fs.writeFileSync(
    agentPath,
    [
      '---',
      'name: test-expert',
      "description: 'Test expert'",
      'displayName:',
      "  en: 'Test Expert'",
      "  zh: '测试专家'",
      'profession:',
      "  en: 'Test Profession'",
      "  zh: '测试职业'",
      '---',
      '',
      body,
    ].join('\n'),
    'utf8',
  );
  return agentPath;
}

test('warns without rejecting imported experts that own workflow progress', () => {
  const result = new ValidationResult();
  const agentPath = writeAgent(
    ['# Test expert', '', '- [ ] Track phase', '', 'Call production_loop then skip_workflow.'].join(
      '\n',
    ),
  );

  validateAgentMd(agentPath, result);

  expect(result.errors).toEqual([]);
  expect(result.warnings).toEqual([
    'test-expert.md: Markdown progress checklists conflict with runtime-owned production progress',
    'test-expert.md: production workflow tools are runtime-owned (production_loop, skip_workflow)',
  ]);
});

test('bundled expert prompts leave production workflow ownership to the runtime', () => {
  const presetsDirectory = path.resolve(__dirname, '..', 'presets');
  const agentPaths = fs.readdirSync(presetsDirectory).flatMap(presetName => {
    const agentsDirectory = path.join(presetsDirectory, presetName, 'agents');
    if (!fs.existsSync(agentsDirectory)) return [];
    return fs
      .readdirSync(agentsDirectory)
      .filter(fileName => fileName.endsWith('.md'))
      .map(fileName => path.join(agentsDirectory, fileName));
  });

  const warnings = agentPaths.flatMap(agentPath => {
    const result = new ValidationResult();
    validateAgentMd(agentPath, result);
    return result.warnings.filter(
      warning =>
        warning.includes('runtime-owned production progress') ||
        warning.includes('production workflow tools are runtime-owned'),
    );
  });

  expect(warnings).toEqual([]);
});
