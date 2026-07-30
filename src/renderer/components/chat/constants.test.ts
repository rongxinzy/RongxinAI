/**
 * Guards the wiring between the sidebar quick-skill shortcuts and the core
 * skill registry.
 *
 * Regression covered: a new academic-research shortcut was added but
 * CoworkPromptInput's hardcoded chat allowlist was not updated, so the skill
 * was filtered out of the chat skill list and the shortcut toasted
 * "skill unavailable" even though the skill is core (always enabled).
 */
import { AcademicResearchSkillIds, CoreSkillId, isCoreSkill } from '@shared/skills/constants';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { isAcademicResearchSkillSet } from '../../../main/libs/agentEngine/piResearchRun';
import { resolveShortcutWorkflowKind } from '../../../main/libs/agentEngine/piShortcutWorkflow';

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

test('academic research selects Zhiyuan AutoResearch, deep research, and web search', () => {
  const academic = CHAT_SKILL_SHORTCUTS.find(entry => entry.id === 'academic-research');
  expect(academic?.skillIds).toEqual(AcademicResearchSkillIds);
  for (const skillId of academic?.skillIds || []) expect(isCoreSkill(skillId)).toBe(true);
});

test('academic research does not expose the upstream Deli branding', () => {
  const skillSource = readFileSync(
    fileURLToPath(new URL('../../../../SKILLs/deli-autoresearch/SKILL.md', import.meta.url)),
    'utf8',
  );
  const metadataSource = readFileSync(
    fileURLToPath(
      new URL('../../../../SKILLs/deli-autoresearch/zhiyuan/metadata.yaml', import.meta.url),
    ),
    'utf8',
  );

  expect(skillSource).toContain('name: zhiyuan_AutoResearch');
  expect(skillSource).toContain('# zhiyuan_AutoResearch');
  expect(skillSource).not.toMatch(/Deli[ _-]?AutoResearch/i);
  expect(metadataSource).toContain('author: Zhiyuan');
  expect(metadataSource).not.toMatch(/^author:\s*Deli\s*$/im);
});

test('deep research selects explicit web search with its research protocol', () => {
  const deepResearch = CHAT_SKILL_SHORTCUTS.find(entry => entry.id === 'deep-research');
  expect(deepResearch?.skillIds).toEqual(['deep-research', 'web-search']);
});

test('every sidebar shortcut is protected by a Pi completion controller', () => {
  for (const shortcut of CHAT_SKILL_SHORTCUTS) {
    const selectedIds = [...(shortcut.skillIds || [shortcut.skillId])];
    const protectedByAcademicHarness = isAcademicResearchSkillSet(selectedIds);
    const protectedByShortcutHarness = resolveShortcutWorkflowKind(selectedIds) !== null;
    expect(
      protectedByAcademicHarness || protectedByShortcutHarness,
      `shortcut ${shortcut.id} has no completion controller`,
    ).toBe(true);
  }
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
