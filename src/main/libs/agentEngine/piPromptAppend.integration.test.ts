import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import {
  assertNoLeakage,
  assertProductIdentity,
  createDurablePromptFixture,
} from '../../../../tests/helpers/promptLeakAssertions';
import { CHAT_IDENTITY_PROMPT } from './piPromptOverrides';

test.each([false, true])(
  'Durable reload updates explicit instructions once (Chat=%s)',
  async chatMode => {
    const directory = await mkdtemp(path.join(tmpdir(), 'durable-prompt-'));
    await writeFile(path.join(directory, 'SYSTEM.md'), 'Ambient instructions must stay private.');
    const fixture = await createDurablePromptFixture({
      cwd: directory,
      state: { chatMode, systemPrompt: 'Original expert policy.' },
    });
    try {
      const initial = await fixture.capture();
      assertNoLeakage(initial);
      assertProductIdentity(initial);
      expect(initial).toContain('Original expert policy.');
      expect(initial).not.toContain('Ambient instructions must stay private.');
      expect(initial.includes(CHAT_IDENTITY_PROMPT)).toBe(chatMode);
      fixture.state.systemPrompt = 'Updated expert policy.';
      const updated = await fixture.capture();
      expect(updated).toContain('Updated expert policy.');
      expect(updated).not.toContain('Original expert policy.');
      expect(updated.includes(CHAT_IDENTITY_PROMPT)).toBe(chatMode);
      expect(await fixture.capture()).toBe(updated);
      assertProductIdentity(updated);
    } finally {
      await fixture.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
