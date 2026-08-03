import { expect, test } from 'vitest';

import {
  HarnessFailureWhere,
  HarnessFailureWhy,
  HarnessFeatureFlag,
  HarnessPatchStatus,
  HarnessPathClass,
  type HarnessPatchManifest,
} from '../../shared/harness';
import { WorkbenchContractKind } from '../../shared/workbenchTask';
import { classifyHarnessPath, validateHarnessPatchBoundary } from './boundaryPolicy';

const manifest = (touchedFiles: string[]): HarnessPatchManifest => ({
  id: 'candidate',
  parentId: 'baseline',
  status: HarnessPatchStatus.Proposed,
  modelProfileId: 'profile',
  workflowKind: WorkbenchContractKind.Research,
  where: HarnessFailureWhere.KnowledgeOrSkill,
  why: HarnessFailureWhy.WrongToolOrSkillRoute,
  touchedFiles,
  activationPredicate: 'skill_loaded',
  featureFlag: HarnessFeatureFlag.IndependentCritic,
  defaultOff: true,
  expectedEffect: 'Improve source selection.',
  rollback: 'Disable the candidate profile.',
  evaluationIds: [],
  promotedVersion: null,
});

test('allows only repository-relative Surface paths', () => {
  expect(classifyHarnessPath('SKILLs/web-search/SKILL.md')).toMatchObject({
    classification: HarnessPathClass.Surface,
    allowed: true,
  });
  expect(
    validateHarnessPatchBoundary(manifest(['src/main/coworkPrompt/templates/research.ts'])),
  ).toHaveLength(1);
});

test('rejects Kernel, unlisted, absolute, and traversal paths', () => {
  expect(classifyHarnessPath('src/main/workbenchTask/taskService.ts')).toMatchObject({
    classification: HarnessPathClass.Kernel,
    allowed: false,
  });
  expect(() => validateHarnessPatchBoundary(manifest(['package.json']))).toThrow(
    'not present in the Harness Surface allowlist',
  );
  expect(classifyHarnessPath('../outside.txt').allowed).toBe(false);
  expect(classifyHarnessPath('C:\\outside.txt').allowed).toBe(false);
});
