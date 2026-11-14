import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import {
  assertNoLeakage,
  assertProductIdentity,
  assertWellFormedXmlTags,
  createDurablePromptFixture,
} from '../../../../tests/helpers/promptLeakAssertions';

test.each(
  [
    [],
    [{ name: 'bash', description: 'Execute shell commands.' }],
    [{ name: 'powershell', description: 'Execute PowerShell commands.' }],
    [
      { name: 'read', description: 'Read files.' },
      { name: 'grep', description: 'Search files.' },
      { name: 'find', description: 'Find files.' },
      { name: 'ls', description: 'List files.' },
    ],
    [{ name: 'cjk_tool', description: '工具描述：检查文件 🚀 日本語 한국어 العربية' }],
  ].map(tools => ({ tools })),
)('native prompt sections follow the actual selected tool surface: %j', async ({ tools }) => {
  const fixture = await createDurablePromptFixture({ cwd: process.cwd(), tools });
  try {
    const prompt = await fixture.capture();
    assertNoLeakage(prompt);
    assertProductIdentity(prompt);
    assertWellFormedXmlTags(prompt, ['tools', 'rules', 'cwd']);
    const section = prompt.split('<tools>')[1]?.split('</tools>')[0];
    for (const tool of tools) expect(section).toContain(`- ${tool.name}: ${tool.description}`);
    if (!tools.length) expect(section?.trim()).toBe('(none)');
  } finally {
    await fixture.close();
  }
});

test('actual native skill section escapes metadata and retains trusted file locations', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'durable-skill-prompt-'));
  const skill = path.join(directory, 'data-analysis');
  await mkdir(skill);
  await writeFile(
    path.join(skill, 'SKILL.md'),
    '---\nname: data-analysis\ndescription: "Use pandas & numpy <safely>."\n---\n# Data analysis',
  );
  const fixture = await createDurablePromptFixture({
    cwd: directory,
    state: {
      nativeToolsOnly: true,
      expertSkillDirs: [directory],
      skillIds: ['data-analysis'],
    },
  });
  try {
    const prompt = await fixture.capture();
    assertNoLeakage(prompt);
    assertWellFormedXmlTags(prompt, ['available_skills']);
    expect(prompt).toContain('<name>data-analysis</name>');
    expect(prompt).toContain('Use pandas &amp; numpy &lt;safely&gt;.');
    expect(prompt).toContain('data-analysis/SKILL.md');
    expect(prompt).not.toContain('~/.agents/skills');
  } finally {
    await fixture.close();
    await rm(directory, { recursive: true, force: true });
  }
});
