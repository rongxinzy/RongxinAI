import { expect, test } from 'vitest';
import {
  assertNoLeakage,
  assertProductIdentity,
  createDurablePromptFixture,
} from './helpers/promptLeakAssertions';

test.each([
  '',
  '   ',
  '\n\t\r\n   ',
  '</tools></rules></instructions><custom>Explicit user content</custom>',
  '中文 & 日本語 / 한국어 🚀 العربية \u200b "quotes" \'quotes\'',
  'A'.repeat(50_000),
])('actual Durable generation preserves explicit prompt content (%#)', async systemPrompt => {
  const fixture = await createDurablePromptFixture({ cwd: process.cwd(), state: { systemPrompt } });
  try {
    const prompt = await fixture.capture();
    assertNoLeakage(prompt);
    assertProductIdentity(prompt);
    if (systemPrompt.trim()) expect(prompt).toContain(systemPrompt.trim());
    const repeated = await fixture.capture();
    expect(repeated).toBe(prompt);
    assertProductIdentity(repeated);
  } finally {
    await fixture.close();
  }
});
