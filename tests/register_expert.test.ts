import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { describe, expect, test } from 'vitest';

import {
  copyTopLevelSkillIdsToUserData,
  getPiAgentsDir,
  parseExpertPackage,
} from '../SKILLs/zhiyuan-expert-manager/scripts/register_expert';
import { validateExpert } from '../SKILLs/zhiyuan-expert-manager/scripts/validate_expert';

function createMinimalExpertPackage(dir: string, overrides: Record<string, unknown> = {}) {
  const agentDir = path.join(dir, 'agents');
  const skillsDir = path.join(dir, 'skills', 'hello-skill');
  fs.mkdirSync(agentDir, { recursive: true });
  fs.mkdirSync(skillsDir, { recursive: true });

  const plugin = {
    name: 'test-code-expert',
    version: '1.0.0',
    description: 'A test expert.',
    author: { name: 'Test', email: 'test@example.com' },
    expertType: 'agent',
    agentName: 'test-code-assistant',
    agents: ['./agents/test-code-assistant.md'],
    skills: ['skills/hello-skill'],
    displayName: { en: 'Test Code Assistant', zh: '测试代码助手' },
    profession: { en: 'Code Assistant', zh: '代码助手' },
    displayDescription: {
      en: 'A lightweight expert for integration testing.',
      zh: '一个用于集成测试的轻量专家，专注于回答简单编程问题、验证导入流程与技能打包语义。',
    },
    categoryId: '02-Engineering',
    defaultInitPrompt: {
      zh: '你好，请帮我写一个 Hello World 程序。',
      en: 'Hello, please help me write a Hello World program.',
    },
    plugin: 'test-code-expert',
    tags: [
      { en: 'Coding', zh: '编程' },
      { en: 'Testing', zh: '测试' },
      { en: 'Q&A', zh: '问答' },
    ],
    quickPrompts: [
      {
        en: 'Hello, please help me write a Hello World program.',
        zh: '你好，请帮我写一个 Hello World 程序。',
      },
      { en: 'Explain what a variable is.', zh: '解释什么是变量。' },
      { en: 'How do I define a function?', zh: '如何定义一个函数？' },
    ],
    ...overrides,
  };

  fs.writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify(plugin, null, 2), 'utf-8');
  fs.writeFileSync(
    path.join(agentDir, 'test-code-assistant.md'),
    `---\nname: test-code-assistant\ndescription: \"A test code assistant for integration testing.\"\ndisplayName:\n  en: \"Test Code Assistant\"\n  zh: \"测试代码助手\"\nprofession:\n  en: \"Code Assistant\"\n  zh: \"代码助手\"\nmaxTurns: 50\nskills: [hello-skill]\n---\n\n# 测试代码助手\n\n## 角色\n你是一个用于集成测试的代码助手。\n\n## 工作流路由（CRITICAL — 收到请求时首先判断）\n\n| 场景 | 判定条件 | 使用模式 |\n|------|---------|---------|\n| 编程问答 | 简单编程问题 | 直接回答 |\n\n## Skill 使用协议（CRITICAL）\n\n1. 从系统提示的 \`<available_skills>\` 中选择与请求最匹配的一个 Skill。\n2. 使用 \`read\` 完整读取该 Skill 的 \`<location>\`，将其所在目录作为 Skill 根目录。\n3. 严格按 \`SKILL.md\` 的输入、工作流与输出规范执行；相对路径一律相对 Skill 根目录解析。\n4. 仅当首个 Skill 明确引用另一个 Skill 时才继续读取，禁止一次性加载全部 Skill。\n5. 若请求跨多个独立工作流，先完成主工作流，再按依赖顺序加载后续 Skill。\n`,
    'utf-8',
  );
  fs.writeFileSync(
    path.join(skillsDir, 'SKILL.md'),
    '# hello-skill\n\n## 元数据\n- 名称: hello-skill\n- 版本: 1.0.0\n- 类型: tool\n',
    'utf-8',
  );
  fs.writeFileSync(path.join(skillsDir, 'index.js'), 'module.exports = { tools: {} };', 'utf-8');
}

describe('parseExpertPackage', () => {
  test('parses a valid single-agent expert package', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-expert-test-'));
    try {
      createMinimalExpertPackage(tmpDir);
      const result = parseExpertPackage(tmpDir);

      expect(result.pluginJson.name).toBe('test-code-expert');
      expect(result.pluginJson.expertType).toBe('agent');
      expect(result.requests).toHaveLength(1);

      const [agent] = result.requests;
      expect(agent.id).toBe('test-code-assistant');
      expect(agent.name).toBe('测试代码助手');
      expect(agent.source).toBe('expert-package');
      expect(agent.skillIds).toEqual(['hello-skill']);
      expect(agent.icon).toBe('agent-avatar-svg:code');
      expect(agent.systemPrompt).toContain('# 测试代码助手');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('accepts Windows CRLF agent frontmatter', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-expert-crlf-test-'));
    try {
      createMinimalExpertPackage(tmpDir);
      const agentPath = path.join(tmpDir, 'agents', 'test-code-assistant.md');
      const content = fs.readFileSync(agentPath, 'utf-8');
      fs.writeFileSync(agentPath, content.replace(/\n/g, '\r\n'), 'utf-8');

      const result = validateExpert(tmpDir);
      expect(result.isValid).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  test('copies bundled skills to userData SKILLs directory', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-expert-test-'));
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-userdata-'));
    try {
      createMinimalExpertPackage(tmpDir);
      parseExpertPackage(tmpDir, { dbPath: path.join(userDataDir, 'zhiyuan.sqlite') });

      const copiedSkillMd = path.join(userDataDir, 'SKILLs', 'hello-skill', 'SKILL.md');
      expect(fs.existsSync(copiedSkillMd)).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      fs.rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  test('rejects package paths that escape the expert directory', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-expert-test-'));
    const outsidePath = path.join(path.dirname(tmpDir), 'outside-agent.md');
    try {
      createMinimalExpertPackage(tmpDir, {
        agents: ['../outside-agent.md'],
      });
      fs.writeFileSync(outsidePath, '# outside', 'utf-8');

      expect(() => parseExpertPackage(tmpDir)).toThrow(/escapes the expert package/);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      fs.rmSync(outsidePath, { force: true });
    }
  });

  test('syncs agent MDs to pi agents directory for subagent discovery', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-expert-test-'));
    const piAgentsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-pi-agents-'));
    const originalEnv = process.env.PI_CODING_AGENT_DIR;
    try {
      // Point pi agents dir to isolated temp directory
      process.env.PI_CODING_AGENT_DIR = piAgentsDir;
      createMinimalExpertPackage(tmpDir);
      const result = parseExpertPackage(tmpDir);

      // Verify piSyncedFiles is returned
      expect(result.piSyncedFiles).toBeDefined();
      expect(result.piSyncedFiles).toHaveLength(1);
      expect(result.piSyncedFiles[0]).toBe('test-code-expert--test-code-assistant.md');

      // Verify the MD was copied to pi agents directory
      const expectedPath = path.join(
        piAgentsDir,
        'agents',
        'test-code-expert--test-code-assistant.md',
      );
      expect(fs.existsSync(expectedPath)).toBe(true);

      // Verify content is the agent MD
      const content = fs.readFileSync(expectedPath, 'utf-8');
      expect(content).toContain('# 测试代码助手');
      expect(content).toContain('name: test-code-assistant');
    } finally {
      process.env.PI_CODING_AGENT_DIR = originalEnv;
      fs.rmSync(tmpDir, { recursive: true, force: true });
      fs.rmSync(piAgentsDir, { recursive: true, force: true });
    }
  });

  test('getPiAgentsDir respects PI_CODING_AGENT_DIR env var', () => {
    const customDir = path.join(os.tmpdir(), 'custom-pi-agent');
    const originalEnv = process.env.PI_CODING_AGENT_DIR;
    try {
      process.env.PI_CODING_AGENT_DIR = customDir;
      const dir = getPiAgentsDir();
      expect(dir).toBe(path.join(customDir, 'agents'));
    } finally {
      process.env.PI_CODING_AGENT_DIR = originalEnv;
    }
  });

  test('getPiAgentsDir defaults to ~/.pi/agent/agents when no env var', () => {
    const originalEnv = process.env.PI_CODING_AGENT_DIR;
    try {
      delete process.env.PI_CODING_AGENT_DIR;
      const dir = getPiAgentsDir();
      expect(dir).toBe(path.join(os.homedir(), '.pi', 'agent', 'agents'));
    } finally {
      process.env.PI_CODING_AGENT_DIR = originalEnv;
    }
  });
});

describe('copyTopLevelSkillIdsToUserData (via parseExpertPackage)', () => {
  function createSkillIdsOnlyExpertPackage(dir, skillIds) {
    const agentDir = path.join(dir, 'agents');
    fs.mkdirSync(agentDir, { recursive: true });
    const plugin = {
      name: 'test-skillids-expert',
      version: '1.0.0',
      description: 'A skillIds-only test expert.',
      author: { name: 'Test', email: 'test@example.com' },
      expertType: 'agent',
      agentName: 'test-skillids-assistant',
      agents: ['./agents/test-skillids-assistant.md'],
      skillIds,
      displayName: { en: 'Test SkillIds Assistant', zh: '测试技能引用助手' },
      profession: { en: 'Assistant', zh: '助手' },
      displayDescription: {
        en: 'A skillIds-only expert for integration testing.',
        zh: '一个仅引用内置技能、不携带任何嵌套技能目录的轻量集成测试专家，专注验证注册流程。',
      },
      categoryId: '02-Engineering',
      defaultInitPrompt: {
        zh: '你好，请帮我完成一次内置技能调用。',
        en: 'Hello, please run a bundled skill for me.',
      },
      plugin: 'test-skillids-expert',
      tags: [
        { en: 'Testing', zh: '测试' },
        { en: 'Coding', zh: '编程' },
        { en: 'Q&A', zh: '问答' },
      ],
      quickPrompts: [
        {
          en: 'Hello, please run a bundled skill for me.',
          zh: '你好，请帮我完成一次内置技能调用。',
        },
        { en: 'Explain what a skill is.', zh: '解释什么是技能。' },
        { en: 'List the bundled skills you can use.', zh: '列出你可以使用的内置技能。' },
      ],
    };
    fs.writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify(plugin, null, 2), 'utf-8');
    fs.writeFileSync(
      path.join(agentDir, 'test-skillids-assistant.md'),
      `---\nname: test-skillids-assistant\ndescription: "A skillIds-only test assistant."\ndisplayName:\n  en: "Test SkillIds Assistant"\n  zh: "测试技能引用助手"\nprofession:\n  en: "Assistant"\n  zh: "助手"\n---\n\n# 测试技能引用助手\n\n## Skill 使用协议（CRITICAL）\n\n1. 从系统提示的 \`<available_skills>\` 中选择与请求最匹配的一个 Skill。\n2. 使用 \`read\` 完整读取该 Skill 的 \`<location>\`。\n3. 严格按 \`SKILL.md\` 执行；禁止一次性加载全部技能，按依赖顺序加载后续技能。\n`,
      'utf-8',
    );
  }

  function createBundledSkill(root, id) {
    const skillDir = path.join(root, id);
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(
      path.join(skillDir, 'SKILL.md'),
      `---\nname: ${id}\ndescription: Bundled skill for tests.\n---\n\n# ${id}\n`,
      'utf-8',
    );
    return skillDir;
  }

  test('materializes top-level skillIds from a bundled SKILLs root into userData', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-expert-test-'));
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-userdata-'));
    const bundledRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-skills-root-'));
    const piAgentsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-pi-agents-'));
    const originalEnv = process.env.PI_CODING_AGENT_DIR;
    try {
      process.env.PI_CODING_AGENT_DIR = piAgentsDir;
      createBundledSkill(bundledRoot, 'fake-bundled-skill');
      createSkillIdsOnlyExpertPackage(tmpDir, ['fake-bundled-skill']);

      parseExpertPackage(tmpDir, {
        dbPath: path.join(userDataDir, 'zhiyuan.sqlite'),
        skillSourceRoots: [bundledRoot],
      });

      const copiedSkillMd = path.join(userDataDir, 'SKILLs', 'fake-bundled-skill', 'SKILL.md');
      expect(fs.existsSync(copiedSkillMd)).toBe(true);
      expect(fs.readFileSync(copiedSkillMd, 'utf-8')).toContain('# fake-bundled-skill');
    } finally {
      process.env.PI_CODING_AGENT_DIR = originalEnv;
      fs.rmSync(tmpDir, { recursive: true, force: true });
      fs.rmSync(userDataDir, { recursive: true, force: true });
      fs.rmSync(bundledRoot, { recursive: true, force: true });
      fs.rmSync(piAgentsDir, { recursive: true, force: true });
    }
  });

  test('warns and continues when a skillId is missing from all source roots', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-expert-test-'));
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-userdata-'));
    const bundledRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-skills-root-'));
    const piAgentsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-pi-agents-'));
    const originalEnv = process.env.PI_CODING_AGENT_DIR;
    const warnings = [];
    const originalWarn = console.warn;
    try {
      process.env.PI_CODING_AGENT_DIR = piAgentsDir;
      console.warn = message => warnings.push(String(message));
      createSkillIdsOnlyExpertPackage(tmpDir, ['no-such-bundled-skill']);

      expect(() =>
        parseExpertPackage(tmpDir, {
          dbPath: path.join(userDataDir, 'zhiyuan.sqlite'),
          skillSourceRoots: [bundledRoot],
        }),
      ).not.toThrow();

      expect(warnings.some(w => w.includes('no-such-bundled-skill'))).toBe(true);
      expect(fs.existsSync(path.join(userDataDir, 'SKILLs', 'no-such-bundled-skill'))).toBe(false);
    } finally {
      console.warn = originalWarn;
      process.env.PI_CODING_AGENT_DIR = originalEnv;
      fs.rmSync(tmpDir, { recursive: true, force: true });
      fs.rmSync(userDataDir, { recursive: true, force: true });
      fs.rmSync(bundledRoot, { recursive: true, force: true });
      fs.rmSync(piAgentsDir, { recursive: true, force: true });
    }
  });

  test('never materializes path-shaped skillIds outside the source roots', () => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-userdata-'));
    const bundledRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyuan-skills-root-'));
    try {
      // A traversal-shaped id must be skipped before any existence check.
      copyTopLevelSkillIdsToUserData(['../escape'], path.join(userDataDir, 'SKILLs'), [
        bundledRoot,
      ]);
      expect(fs.readdirSync(userDataDir)).toEqual([]);
    } finally {
      fs.rmSync(userDataDir, { recursive: true, force: true });
      fs.rmSync(bundledRoot, { recursive: true, force: true });
    }
  });
});
