import { expect, test } from 'vitest';

import { HarnessVersion } from '../../shared/harness';
import { WorkbenchContractKind } from '../../shared/workbenchTask';
import { createHarnessModelProfile } from './modelProfile';

test('creates a stable model profile identity from normalized fields', () => {
  const first = createHarnessModelProfile({
    provider: ' OpenAI ',
    model: 'gemma-4-31B-it',
    reasoningProfile: ' Enabled ',
    workflowKind: WorkbenchContractKind.Research,
    harnessVersion: HarnessVersion,
  });
  const second = createHarnessModelProfile({
    provider: 'openai',
    model: 'gemma-4-31B-it',
    reasoningProfile: 'enabled',
    workflowKind: WorkbenchContractKind.Research,
    harnessVersion: HarnessVersion,
  });

  expect(first).toEqual(second);
  expect(first.id).toMatch(/^[a-f0-9]{24}$/);
});

test('changes profile identity when model or workflow changes', () => {
  const base = {
    provider: 'openai',
    model: 'gemma-4-31B-it',
    reasoningProfile: 'default',
    harnessVersion: HarnessVersion,
  };
  const chat = createHarnessModelProfile({ ...base, workflowKind: WorkbenchContractKind.Chat });
  const work = createHarnessModelProfile({
    ...base,
    workflowKind: WorkbenchContractKind.GenericWork,
  });
  expect(chat.id).not.toBe(work.id);
});
