import { createHash } from 'crypto';

import type { HarnessModelProfile, HarnessModelProfileInput } from '../../shared/harness';

export function createHarnessModelProfile(input: HarnessModelProfileInput): HarnessModelProfile {
  const normalized = {
    provider: input.provider.trim().toLowerCase(),
    model: input.model.trim(),
    reasoningProfile: input.reasoningProfile.trim().toLowerCase() || 'default',
    workflowKind: input.workflowKind,
    harnessVersion: input.harnessVersion.trim(),
  };
  const id = createHash('sha256').update(JSON.stringify(normalized)).digest('hex').slice(0, 24);
  return { id, ...normalized };
}
