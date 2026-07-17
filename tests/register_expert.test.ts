import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import { describe, expect, test } from 'vitest';

import { getPiAgentsDir, parseExpertPackage } from '../SKILLs/zhiyuan-expert-manager/scripts/register_expert';
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
      zh: '一个用于集成测试的轻量专家，专注于回答简单编程问题，验证导入流程。',
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
      { en: 'Hello, please help me write a Hello World program.', zh: '你好，请帮我写一个 Hello World 程序。' },
      { en: 'Explain what a variable is.', zh: '解释什么是变量。' },
      { en: 'How do I define a function?', zh: '如何定义一个函数？' },
    ],
    ...overrides,
  };

  fs.writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify(plugin, null, 2), 'utf-8');
  fs.writeFileSync(
    path.join(agentDir, 'test-code-assistant.md'),
    `---\nname: test-code-assistant\ndescription: \"A test code assistant for integration testing.\"\ndisplayName:\n  en: \"Test Code Assistant\"\n  zh: \"测试代码助手\"\nprofession:\n  en: \"Code Assistant\"\n  zh: \"代码助手\"\nmaxTurns: 50\nskills: [hello-skill]\n---\n\n# 测试代码助手\n\n## 角色\n你是一个用于集成测试的代码助手。\n`,
    'utf-8',
  );
  fs.writeFileSync(
    path.join(skillsDir, 'SKILL.md'),
    '# hello-skill\n\n## 元数据\n- 名称: hello-skill\n- 版本: 1.0.0\n- 类型: tool\n',
    'utf-8',
  );
  fs.writeFileSync(
    path.join(skillsDir, 'index.js'),
    'module.exports = { tools: {} };',
    'utf-8',
  );
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
      const expectedPath = path.join(piAgentsDir, 'agents', 'test-code-expert--test-code-assistant.md');
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
