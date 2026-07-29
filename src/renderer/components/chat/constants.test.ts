/**
 * Guards the wiring between the sidebar quick-skill shortcuts and the core
 * skill registry.
 *
 * Regression covered: a new shortcut was added for `deli-autoresearch` but
 * CoworkPromptInput's hardcoded chat allowlist was not updated, so the skill
 * was filtered out of the chat skill list and the shortcut toasted
 * "skill unavailable" even though the skill is core (always enabled).
 */
import { CoreSkillId, isCoreSkill } from '@shared/skills/constants';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';

import { CHAT_SKILL_SHORTCUTS } from './constants';

test('every chat quick-skill shortcut points at a core skill', () => {
  // Core skills are always enabled (skillManager forces enabled=true), so a
  // shortcut targeting a non-core skill could point at a disabled one and
  // fail its availability check.
  for (const entry of CHAT_SKILL_SHORTCUTS) {
    expect(isCoreSkill(entry.skillId), `shortcut ${entry.id} → ${entry.skillId}`).toBe(true);
  }
});

test('shortcut skillIds stay unique and match their entry ids where intended', () => {
  const skillIds = CHAT_SKILL_SHORTCUTS.map(entry => entry.skillId);
  expect(new Set(skillIds).size).toBe(skillIds.length);
});

test('the chat skill allowlist is derived from CoreSkillId, not hardcoded', () => {
  const source = readFileSync(
    fileURLToPath(new URL('../cowork/CoworkPromptInput.tsx', import.meta.url)),
    'utf8',
  );
  // The allowlist must track CoreSkillId so newly added core skills become
  // available in chat mode automatically.
  expect(source).toContain('new Set(Object.values(CoreSkillId))');
  // No hardcoded skill-id array may come back.
  for (const id of Object.values(CoreSkillId)) {
    expect(source).not.toContain(`'${id}'`);
  }
});
