import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const { validateAgentMd, ValidationResult } = require(
  '../SKILLs/zhiyuan-expert-manager/scripts/validate_expert.js',
) as {
  validateAgentMd: (
    mdPath: string,
    result: { errors: string[]; warnings: string[] },
    options?: { requireSkillProtocol?: boolean; strict?: boolean },
  ) => void;
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

test('rejects imported experts that own workflow progress', () => {
  const result = new ValidationResult();
  const agentPath = writeAgent(
    [
      '# Test expert',
      '',
      '## 任务进度',
      '- [ ] Track phase',
      '',
      'Call production_loop then skip_workflow.',
    ].join('\n'),
  );

  validateAgentMd(agentPath, result);

  expect(result.warnings).toEqual([]);
  expect(result.errors).toEqual([
    'test-expert.md: Markdown progress checklists conflict with runtime-owned production progress (任务进度)',
    'test-expert.md: production workflow tools are runtime-owned (production_loop, skip_workflow)',
  ]);
});

test('allows checkboxes inside delivery templates and domain QA sections', () => {
  const result = new ValidationResult();
  const agentPath = writeAgent(
    [
      '# Test expert',
      '',
      '## 输出规范',
      '- [x] 已核对数据来源',
      '- [ ] 待用户确认口径',
    ].join('\n'),
  );

  validateAgentMd(agentPath, result);

  expect(result.errors).toEqual([]);
});

test('primary agents must carry the full Skill usage protocol in its own section', () => {
  const result = new ValidationResult();
  const agentPath = writeAgent(
    [
      '# Test expert',
      '',
      '## Skill 使用协议（CRITICAL）',
      '',
      '1. 从系统提示的 `<available_skills>` 中选择最匹配的 Skill。',
      '2. 使用 `read` 完整读取该 Skill 的 `<location>`。',
      '3. 严格按 `SKILL.md` 执行。',
    ].join('\n'),
  );

  validateAgentMd(agentPath, result, { requireSkillProtocol: true });

  expect(result.errors).toHaveLength(1);
  expect(result.errors[0]).toContain('missing: 禁止一次性加载全部技能、按依赖顺序加载后续技能');
});

test('keywords outside the protocol section cannot satisfy the requirement', () => {
  const result = new ValidationResult();
  const agentPath = writeAgent(
    [
      '# Test expert',
      '',
      '## 概述',
      '从 `<available_skills>` 中选择，`read` 读取 `<location>`，严格按 `SKILL.md` 执行，',
      '禁止一次性加载全部技能，按依赖顺序加载后续技能。',
      '',
      '## Skill 使用协议（CRITICAL）',
      '',
      '1. 保持简短。',
    ].join('\n'),
  );

  validateAgentMd(agentPath, result, { requireSkillProtocol: true });

  expect(result.errors).toHaveLength(1);
  expect(result.errors[0]).toContain('missing: 从 <available_skills> 中选择、使用 read 读取 <location>');
});

test('members and skill-less leads are exempt from the protocol requirement', () => {
  const result = new ValidationResult();
  const agentPath = writeAgent(['# Test member', '', '你是团队的**[TODO: 角色]**。'].join('\n'));

  validateAgentMd(agentPath, result, { requireSkillProtocol: false });

  expect(result.errors).toEqual([]);
});

test('half-width dash variants in the routing heading are strict-only errors', () => {
  for (const heading of [
    '## 工作流路由（CRITICAL - 收到请求时首先判断）',
    '## 工作流路由（CRITICAL-收到请求时首先判断）',
    '## 工作流路由（CRITICAL -收到请求时首先判断）',
  ]) {
    const relaxed = new ValidationResult();
    validateAgentMd(writeAgent(['# Test expert', '', heading].join('\n')), relaxed);
    expect(relaxed.errors).toEqual([]);
    expect(relaxed.warnings).toHaveLength(1);

    const strict = new ValidationResult();
    validateAgentMd(writeAgent(['# Test expert', '', heading].join('\n')), strict, {
      strict: true,
    });
    expect(strict.warnings).toEqual([]);
    expect(strict.errors).toHaveLength(1);
  }
});
