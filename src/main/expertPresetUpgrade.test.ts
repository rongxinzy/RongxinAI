import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const { registerExpert } = require('../../SKILLs/zhiyuan-expert-manager/scripts/register_expert.js') as {
  registerExpert: (
    expertDir: string,
    options: { dbPath?: string; update?: boolean },
  ) => { pluginJson: { name: string }; agentIds: string[] };
};

let tempRoot: string;
let dbPath: string;
let presetDir: string;

/** Minimal valid expert package in a temp dir — exercises the register/upgrade path without touching real user data. */
const buildPreset = (version: string, skillIds: string[]): void => {
  fs.rmSync(presetDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(presetDir, 'agents'), { recursive: true });
  fs.mkdirSync(path.join(presetDir, 'skills', 'upgrade-test-skill'), { recursive: true });
  fs.writeFileSync(
    path.join(presetDir, 'plugin.json'),
    JSON.stringify(
      {
        name: 'upgrade-test-preset',
        version,
        description: 'Test preset for upgrade semantics.',
        author: { name: 'ZhiYuanAgent' },
        expertType: 'agent',
        agentName: 'upgrade-test-agent',
        agents: ['./agents/upgrade-test-agent.md'],
        skills: ['./skills/upgrade-test-skill'],
        skillIds,
        displayName: { en: 'Upgrade Test Agent', zh: '升级测试专家' },
        profession: { en: 'Test Profession', zh: '测试职业' },
        displayDescription: { en: 'Test.', zh: '升级测试专家用于完整验证专家预设的原地升级语义、技能打包刷新行为与注册流程幂等性。' },
        categoryId: '04-DataAI',
        defaultInitPrompt: { zh: '测试升级', en: 'Test upgrade' },
        plugin: 'upgrade-test-preset',
        tags: [
          { en: 'Tag A', zh: '标签一' },
          { en: 'Tag B', zh: '标签二' },
          { en: 'Tag C', zh: '标签三' },
        ],
        quickPrompts: [
          { zh: '测试升级', en: 'Test upgrade' },
          { zh: '测试二', en: 'Test two' },
          { zh: '测试三', en: 'Test three' },
        ],
      },
      null,
      2,
    ),
  );
  fs.writeFileSync(
    path.join(presetDir, 'agents', 'upgrade-test-agent.md'),
    [
      '---',
      'name: upgrade-test-agent',
      'description: Test agent.',
      'displayName:',
      '  en: Upgrade Test Agent',
      '  zh: 升级测试专家',
      'profession:',
      '  en: Test Profession',
      '  zh: 测试职业',
      '---',
      `# 升级测试专家 v${version}`,
      '',
      `你是**升级测试专家**(版本 ${version})。`,
      '',
      '## 工作流路由（CRITICAL — 收到请求时首先判断）',
      '',
      '| 场景 | 判定条件 | 使用模式 |',
      '|------|---------|---------|',
      '| 升级验证 | 验证预设升级语义 | upgrade-test-skill |',
      '',
      '## Skill 使用协议（CRITICAL）',
      '',
      '1. 从系统提示的 `<available_skills>` 中选择与请求最匹配的一个 Skill。',
      '2. 使用 `read` 完整读取该 Skill 的 `<location>`，将其所在目录作为 Skill 根目录。',
      '3. 严格按 `SKILL.md` 的输入、工作流与输出规范执行；相对路径一律相对 Skill 根目录解析。',
      '4. 仅当首个 Skill 明确引用另一个 Skill 时才继续读取，禁止一次性加载全部 Skill。',
      '5. 若请求跨多个独立工作流，先完成主工作流，再按依赖顺序加载后续 Skill。',
    ].join('\n'),
  );
  fs.writeFileSync(
    path.join(presetDir, 'skills', 'upgrade-test-skill', 'SKILL.md'),
    ['---', 'name: upgrade-test-skill', 'description: Test skill.', '---', '', `# v${version}`].join(
      '\n',
    ),
  );
};

beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'expert-upgrade-test-'));
  dbPath = path.join(tempRoot, 'test.sqlite');
  presetDir = path.join(tempRoot, 'preset');
  // Keep the pi agents sync hermetic — never touch ~/.pi/agent.
  process.env.PI_CODING_AGENT_DIR = path.join(tempRoot, 'pi-agent');
});

afterEach(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
  delete process.env.PI_CODING_AGENT_DIR;
});

const queryAgent = (sqlite: typeof import('better-sqlite3'), name: string) => {
  const Database = sqlite.default ?? sqlite;
  const db = new Database(dbPath);
  const row = db
    .prepare('SELECT id, name, system_prompt, skill_ids FROM agents WHERE name = ?')
    .get(name) as { id: string; name: string; system_prompt: string; skill_ids: string };
  db.close();
  return row;
};

test('registers a preset and upgrades it in place with --update', () => {
  const sqlite = require('better-sqlite3') as typeof import('better-sqlite3');

  buildPreset('1.0.0', ['web-search']);
  const first = registerExpert(presetDir, { dbPath });
  expect(first.agentIds).toHaveLength(1);

  const installed = queryAgent(sqlite, '升级测试专家');
  expect(installed.system_prompt).toContain('v1.0.0');
  expect(JSON.parse(installed.skill_ids)).toEqual(['web-search', 'upgrade-test-skill']);

  // Re-registering without --update must fail, not create a duplicate.
  expect(() => registerExpert(presetDir, { dbPath })).toThrow(/already exists/);

  // Upgrade replaces the system prompt and skill list in place.
  buildPreset('2.0.0', ['web-search', 'deep-research']);
  const upgraded = registerExpert(presetDir, { dbPath, update: true });
  expect(upgraded.agentIds).toEqual(first.agentIds);

  const after = queryAgent(sqlite, '升级测试专家');
  expect(after.id).toBe(installed.id);
  expect(after.system_prompt).toContain('v2.0.0');
  expect(JSON.parse(after.skill_ids)).toEqual([
    'web-search',
    'deep-research',
    'upgrade-test-skill',
  ]);

  // Only one agent row exists — no timestamp-suffixed duplicates.
  const Database = sqlite.default ?? sqlite;
  const db = new Database(dbPath);
  const count = (db.prepare('SELECT COUNT(*) c FROM agents').get() as { c: number }).c;
  db.close();
  expect(count).toBe(1);
});

test('upgrade refreshes packaged skills in the user data skills directory', () => {
  const userDataSkillsDir = path.join(tempRoot, 'SKILLs');

  buildPreset('1.0.0', []);
  registerExpert(presetDir, { dbPath });

  const skillPath = path.join(userDataSkillsDir, 'upgrade-test-skill', 'SKILL.md');
  expect(fs.readFileSync(skillPath, 'utf-8')).toContain('v1.0.0');

  buildPreset('2.0.0', []);
  registerExpert(presetDir, { dbPath, update: true });
  expect(fs.readFileSync(skillPath, 'utf-8')).toContain('v2.0.0');
});
