import { expect, test } from 'vitest';
import { CHAT_IDENTITY_PROMPT } from '../src/main/libs/agentEngine/piPromptOverrides';
import { PiUnattendedSystemPrompt } from '../src/main/libs/agentEngine/piUnattendedPolicy';
import { SessionSummarySystemPrompt } from '../src/main/sessionSummary/tool';
import {
  assertNoLeakage,
  assertProductIdentity,
  assertWellFormedXmlTags,
  createDurablePromptFixture,
} from './helpers/promptLeakAssertions';

test.each([
  { chatMode: false, unattended: false },
  { chatMode: false, unattended: true },
  { chatMode: true, unattended: false },
  { chatMode: true, unattended: true },
])('real Durable prompt preserves product policies for $chatMode/$unattended', async state => {
  const fixture = await createDurablePromptFixture({
    cwd: process.cwd(),
    state: { ...state, systemPrompt: 'Selected expert instructions.' },
  });
  try {
    const prompt = await fixture.capture();
    assertNoLeakage(prompt);
    assertProductIdentity(prompt);
    assertWellFormedXmlTags(prompt, state.chatMode ? ['rules'] : ['tools', 'rules', 'cwd']);
    expect(prompt).toContain('Selected expert instructions.');
    expect(prompt.includes(CHAT_IDENTITY_PROMPT)).toBe(state.chatMode);
    expect(prompt.includes(SessionSummarySystemPrompt)).toBe(!state.chatMode);
    expect(prompt.includes(PiUnattendedSystemPrompt)).toBe(state.unattended);
  } finally {
    await fixture.close();
  }
});

test.each(
  [
    [],
    [{ name: 'read', description: '' }],
    [
      { name: 'read', description: 'Read a file.' },
      { name: 'grep', description: 'Search text.' },
      { name: 'cjk_tool', description: '检查 Unicode 🚀' },
    ],
  ].map(tools => ({ tools })),
)('native selected tool surfaces render without SDK prompt leakage: %j', async ({ tools }) => {
  const fixture = await createDurablePromptFixture({ cwd: process.cwd(), tools });
  try {
    const prompt = await fixture.capture();
    assertNoLeakage(prompt);
    assertProductIdentity(prompt);
    assertWellFormedXmlTags(prompt, ['tools', 'rules', 'cwd']);
    for (const tool of tools)
      expect(prompt).toContain(`- ${tool.name}: ${tool.description}`.trimEnd());
    if (!tools.length) expect(prompt).toContain('<tools>\n(none)\n</tools>');
  } finally {
    await fixture.close();
  }
});
