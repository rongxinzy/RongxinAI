import { expect, test } from 'vitest';

import { CoworkSessionMode } from '../../shared/cowork/constants';
import { WorkbenchContractKind } from '../../shared/workbenchTask';
import { shouldExposeProductionControls, shouldRequireProductionOnResume } from './entryPolicy';

const workRequest = (prompt: string) => ({ sessionMode: CoworkSessionMode.Work, prompt });

test('keeps production controls available for every new Work turn', () => {
  expect(shouldExposeProductionControls(workRequest('你好'))).toBe(true);
  expect(shouldExposeProductionControls(workRequest('为什么天空是蓝色的？'))).toBe(true);
  expect(shouldExposeProductionControls(workRequest('预测一下五粮液走向'))).toBe(true);
  expect(shouldExposeProductionControls(workRequest('Create and validate a release report'))).toBe(
    true,
  );
  expect(shouldExposeProductionControls({ prompt: 'Handle the request' })).toBe(true);
});

test('keeps Chat mode outside the production workflow', () => {
  expect(
    shouldExposeProductionControls({
      sessionMode: CoworkSessionMode.Chat,
      prompt: 'Create and validate a release report',
      goalMode: true,
    }),
  ).toBe(false);
});

test('keeps controls available while carrying resume activation separately', () => {
  expect(
    shouldExposeProductionControls({
      ...workRequest('Continue'),
      inheritedProductionRequired: true,
    }),
  ).toBe(true);
  expect(
    shouldExposeProductionControls({
      ...workRequest('Continue'),
      inheritedProductionRequired: false,
    }),
  ).toBe(true);
});

test('does not classify natural-language intent or incidental resources', () => {
  const incidentalContext = {
    ...workRequest('继续'),
    skillIds: ['presentation-studio'],
    expertIds: ['reviewer'],
    imageAttachmentCount: 1,
    resumeRun: true,
  };
  expect(shouldExposeProductionControls(incidentalContext)).toBe(true);
  expect(
    shouldExposeProductionControls({
      ...incidentalContext,
      prompt: 'Read package.json',
    }),
  ).toBe(true);
});

test('resumes only production that was previously activated or domain-controlled', () => {
  expect(shouldRequireProductionOnResume(WorkbenchContractKind.GenericWork, null)).toBe(false);
  expect(shouldRequireProductionOnResume(WorkbenchContractKind.GenericWork, { skip: null })).toBe(
    true,
  );
  expect(
    shouldRequireProductionOnResume(WorkbenchContractKind.GenericWork, {
      skip: { reason: 'Direct answer', createdAt: 1 },
    }),
  ).toBe(false);
  expect(shouldRequireProductionOnResume(WorkbenchContractKind.Research, null)).toBe(true);
  expect(shouldRequireProductionOnResume(WorkbenchContractKind.Shortcut, null)).toBe(true);
  expect(shouldRequireProductionOnResume(WorkbenchContractKind.Chat, null)).toBe(false);
});
