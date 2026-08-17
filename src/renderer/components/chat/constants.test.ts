/**
 * Guards the wiring between the sidebar quick-skill shortcuts and the core
 * skill registry.
 *
 * Regression covered: locally enabled skills were filtered out of Chat even
 * though the same skills were available in Work.
 */
import { AcademicResearchSkillIds, isCoreSkill } from '@shared/skills/constants';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { isAcademicResearchSkillSet } from '../../../main/libs/agentEngine/piResearchRun';
import { resolveShortcutWorkflowKind } from '../../../main/libs/agentEngine/piShortcutWorkflow';

import { expect, test } from 'vitest';

import { CoworkPermissionMode } from '../../../shared/cowork/constants';
import {
  CHAT_SKILL_SHORTCUTS,
  isChatSkillShortcutActive,
  resolveChatSkillShortcutPermissionMode,
} from './constants';

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

test('academic research keeps a valid internal Skill name and Zhiyuan-facing metadata', () => {
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

  expect(skillSource).toContain('name: deli-autoresearch');
  // deli-autoresearch is the stable runtime ID. The visible metadata must
  // remain Zhiyuan-branded rather than exposing that implementation detail.
  expect(skillSource).toContain('# zhiyuan_AutoResearch');
  expect(metadataSource).toContain('author: Zhiyuan');
  expect(metadataSource).not.toMatch(/^author:\s*Deli\s*$/im);
});

test('deep research selects explicit web search with its research protocol', () => {
  const deepResearch = CHAT_SKILL_SHORTCUTS.find(entry => entry.id === 'deep-research');
  expect(deepResearch?.skillIds).toEqual(['deep-research', 'web-search']);
});

test('quick skill selection requires an exact skill set', () => {
  const deepResearch = CHAT_SKILL_SHORTCUTS.find(entry => entry.id === 'deep-research');
  const academicResearch = CHAT_SKILL_SHORTCUTS.find(entry => entry.id === 'academic-research');

  expect(deepResearch).toBeDefined();
  expect(academicResearch).toBeDefined();
  expect(isChatSkillShortcutActive(deepResearch!, ['deep-research', 'web-search'])).toBe(true);
  expect(
    isChatSkillShortcutActive(academicResearch!, [
      'deli-autoresearch',
      'deep-research',
      'web-search',
    ]),
  ).toBe(true);
  expect(
    isChatSkillShortcutActive(deepResearch!, [
      'deli-autoresearch',
      'deep-research',
      'web-search',
    ]),
  ).toBe(false);
});

test('quick skill selections automatically allow tools for their chat session only', () => {
  for (const shortcut of CHAT_SKILL_SHORTCUTS) {
    expect(
      resolveChatSkillShortcutPermissionMode(
        shortcut.skillIds ?? [shortcut.skillId],
        CoworkPermissionMode.Ask,
      ),
    ).toBe(CoworkPermissionMode.AllowAll);
  }
  expect(
    resolveChatSkillShortcutPermissionMode(['presentation-studio', 'web-search'], CoworkPermissionMode.Ask),
  ).toBe(CoworkPermissionMode.Ask);
  expect(resolveChatSkillShortcutPermissionMode([], CoworkPermissionMode.AllowAll)).toBe(
    CoworkPermissionMode.AllowAll,
  );
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

test('chat uses the complete local skill registry shared with Work', () => {
  const source = readFileSync(
    fileURLToPath(new URL('../cowork/CoworkPromptInput.tsx', import.meta.url)),
    'utf8',
  );
  expect(source).toContain('dispatch(setSkills(loadedSkills));');
  expect(source).not.toContain('CHAT_SKILL_IDS');
  expect(source).not.toContain('loadedSkills.filter');
});
