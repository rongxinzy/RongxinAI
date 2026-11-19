import { isDeepStrictEqual } from 'node:util';
import { expect, test } from 'vitest';
import { csvFixture } from './piNativeABFixtures';
import {
  probeInputTokens,
  provider,
  type LivePiRequest,
  type LiveRequestTransform,
} from './piNativeABProvider';
import { reportEvaluationRow, runEvaluationArm } from './piNativeABRunner';
import { recallFixture, scheduledTaskFixture } from './piWorkAblationFixtures';

const Profile = { Factor: 'factor', Candidate: 'candidate' } as const;
const Intervention = {
  Control: 'control',
  PromptOnly: 'prompt-only',
  ToolsOnly: 'tools-only',
} as const;
type Intervention = (typeof Intervention)[keyof typeof Intervention];
const enabled = process.env.PI_ABLATION === '1';
const profile = process.env.PI_ABLATION_PROFILE ?? Profile.Factor;
const candidate = profile === Profile.Candidate;
const group = process.env.PI_ABLATION_GROUP;
const reportPath = process.env.PI_ABLATION_REPORT;
if (enabled && profile !== Profile.Factor && !candidate)
  throw new Error('Unknown PI_ABLATION_PROFILE.');
if (enabled && group && !['csv', 'scheduled', 'memory', 'probe'].includes(group))
  throw new Error('Unknown PI_ABLATION_GROUP.');
const nativeToolNames = new Set([
  'read',
  'write',
  'bash',
  'powershell',
  'edit',
  'grep',
  'find',
  'ls',
]);
const PromptCut = { Both: 'both', Scheduled: 'scheduled', Checkpoint: 'checkpoint' } as const;
type PromptCut = (typeof PromptCut)[keyof typeof PromptCut];
// Exact historical payloads from the baseline, even after candidate code removes them.
const scheduledStart = '<cowork-managed-scheduled-tasks>';
const scheduledEnd = '</cowork-managed-scheduled-tasks>';
const checkpointContribution =
  '## Session checkpoint\n\n- Checkpoints preserve progress and discoveries across turns and sessions. The host persists them with session/run identity and sequence.';

function isInstruction(message: { role?: string }): boolean {
  return message.role === 'system' || message.role === 'developer';
}

function rewriteInstructions(
  request: LivePiRequest,
  rewrite: (content: string) => string,
): LivePiRequest {
  return {
    ...request,
    messages: request.messages?.map(message =>
      isInstruction(message) && typeof message.content === 'string'
        ? { ...message, content: rewrite(message.content) }
        : message,
    ),
  };
}

function removePromptDuplicates(
  request: LivePiRequest,
  cut: PromptCut = PromptCut.Both,
): LivePiRequest {
  const cutSchedule = cut !== PromptCut.Checkpoint;
  const cutCheckpoint = cut !== PromptCut.Scheduled;
  let removed = 0;
  const changed = rewriteInstructions(request, content => {
    const start = cutSchedule ? content.indexOf(scheduledStart) : -1;
    const end = start >= 0 ? content.indexOf(scheduledEnd, start + scheduledStart.length) : -1;
    if (start >= 0 && end >= 0) {
      content = content.slice(0, start) + content.slice(end + scheduledEnd.length);
      removed += 1;
    }
    if (cutCheckpoint && content.includes(checkpointContribution)) {
      content = content.replace(checkpointContribution, '');
      removed += 1;
    }
    return content;
  });
  if (removed !== Number(cutSchedule) + Number(cutCheckpoint)) {
    throw new Error(`Managed prompt blocks did not match the expected ${cut} cut.`);
  }
  return changed;
}

function removeWorkOnlySchemas(request: LivePiRequest): LivePiRequest {
  const tools = request.tools?.filter(tool => nativeToolNames.has(tool.function?.name ?? ''));
  if (!tools?.length || tools.length >= (request.tools?.length ?? 0))
    throw new Error('Expected both native and Work-only tool schemas.');
  return { ...request, tools };
}

function replaceWithNativeInstructions(
  work: LivePiRequest,
  native: LivePiRequest,
  nativeCwd: string,
  workCwd: string,
): LivePiRequest {
  const shared =
    native.messages
      ?.filter(isInstruction)
      .map(message =>
        typeof message.content === 'string'
          ? { ...message, content: message.content.replaceAll(nativeCwd, workCwd) }
          : message,
      ) ?? [];
  if (!shared.length || !work.messages?.some(isInstruction))
    throw new Error('Native or Work first-request instructions are missing.');
  return {
    ...work,
    messages: [...shared, ...work.messages.filter(message => !isInstruction(message))],
  };
}

function extractText(content: unknown): string | null {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return null;
  const parts: string[] = [];
  for (const item of content) {
    if (
      item &&
      typeof item === 'object' &&
      (item as { type?: unknown }).type === 'text' &&
      typeof (item as { text?: unknown }).text === 'string'
    ) {
      parts.push((item as { text: string }).text);
    } else {
      return null;
    }
  }
  return parts.join('\n\n');
}

function removeMemory(request: LivePiRequest, blocks: readonly string[]): LivePiRequest {
  if (!blocks.length) throw new Error('Synthetic memory fixture had no emitted blocks.');
  let replacements = 0;
  const strippedInstructions = rewriteInstructions(request, content => {
    for (const block of blocks) {
      if (content.includes(`\n\n${block}`)) {
        content = content.replace(`\n\n${block}`, '');
      } else if (content.startsWith(`${block}\n\n`)) {
        content = content.slice(block.length + 2);
      } else continue;
      replacements += 1;
    }
    return content;
  });
  const sourceMessages = strippedInstructions.messages ?? [];
  const filteredMessages = sourceMessages.filter((message, index) => {
    if (message.role === 'user' && index > 0 && sourceMessages[index - 1]?.role === 'user') {
      const text = extractText(message.content);
      if (text !== null && blocks.includes(text)) {
        replacements += 1;
        return false;
      }
    }
    return true;
  });
  const changed =
    filteredMessages.length === sourceMessages.length
      ? strippedInstructions
      : { ...strippedInstructions, messages: filteredMessages };
  if (replacements !== blocks.length)
    throw new Error('Could not isolate exact synthetic memory block.');
  return changed;
}

const transforms: Partial<Record<Intervention, LiveRequestTransform>> = {
  [Intervention.PromptOnly]: removePromptDuplicates,
  [Intervention.ToolsOnly]: removeWorkOnlySchemas,
};

type Summary = Awaited<ReturnType<typeof runEvaluationArm>>['summary'];

function observe(
  scenario: string,
  intervention: string,
  variant: number,
  summary: Summary,
  repeat = 0,
): boolean {
  const correct =
    isDeepStrictEqual(summary.actual, summary.expected) &&
    summary.inputsUnchanged &&
    summary.onlyExpectedFiles &&
    !summary.executionError;
  reportEvaluationRow(
    'PiWorkAblation',
    { scenario, intervention, variant, repeat, correct, ...summary },
    reportPath,
  );
  return correct;
}

function assertComparable(summaries: Summary[]): void {
  for (const summary of summaries) {
    expect(summary.relayError).toBeUndefined();
    const successes = summary.responseStatuses.filter(status => status === 200).length;
    expect(successes).toBeGreaterThan(0);
    expect(summary.usageRequests).toBe(successes);
    expect(summary.modelResponseRequests).toBe(successes);
    expect(summary.observedModels).toHaveLength(1);
  }
  expect(new Set(summaries.flatMap(summary => summary.observedModels)).size).toBe(1);
}

// Opt in only. Run target combinations under one explicit provider and shared budget.
// PI_ABLATION=1 PI_AB_USE_ZHIYUAN_INTRANET=1 bunx --no-install vitest run tests/evaluation/piWorkAblation.test.ts
// Set PI_ABLATION_CSV_REPEATS=2 to repeat both matched CSV variants in reverse order.
test.skipIf(!enabled || (group && group !== 'csv'))(
  'measures Work single-factor changes on the same CSV fixtures',
  { timeout: 600000 },
  async () => {
    const config = await provider();
    const repeats = Number(process.env.PI_ABLATION_CSV_REPEATS ?? 1);
    if (!Number.isSafeInteger(repeats) || repeats < 1)
      throw new Error('PI_ABLATION_CSV_REPEATS must be a positive integer.');
    const orders: Intervention[][] = candidate
      ? [[Intervention.Control], [Intervention.Control]]
      : [
          [Intervention.Control, Intervention.PromptOnly, Intervention.ToolsOnly],
          [Intervention.ToolsOnly, Intervention.PromptOnly, Intervention.Control],
        ];
    const summaries: Summary[] = [];
    for (let repeat = 0; repeat < repeats; repeat += 1) {
      const variants = [...orders.entries()];
      if (repeat % 2 === 1) variants.reverse();
      for (const [variant, order] of variants) {
        const interventions = repeat % 2 === 1 ? [...order].reverse() : order;
        for (const intervention of interventions) {
          const { summary } = await runEvaluationArm({
            arm: 'work',
            config,
            fixture: cwd => csvFixture(cwd, variant),
            transform: transforms[intervention],
          });
          observe('csv', intervention, variant, summary, repeat);
          summaries.push(summary);
        }
      }
    }
    assertComparable(summaries);
  },
);

test.skipIf(!enabled || (group && group !== 'scheduled'))(
  'checks the real scheduled task tool after prompt trimming',
  { timeout: 300000 },
  async () => {
    const config = await provider();
    const interventions = candidate
      ? [Intervention.Control]
      : [Intervention.Control, Intervention.PromptOnly];
    const summaries: Summary[] = [];
    const outcomes: boolean[] = [];
    for (const intervention of interventions) {
      const { summary } = await runEvaluationArm({
        arm: 'work',
        config,
        fixture: scheduledTaskFixture,
        transform: transforms[intervention],
      });
      outcomes.push(observe('scheduled', intervention, 0, summary));
      summaries.push(summary);
    }
    assertComparable(summaries);
    expect(outcomes.every(Boolean)).toBe(true);
  },
);

test.skipIf(!enabled || (group && group !== 'memory'))(
  'measures model-visible recalled memory using the same Work tools',
  { timeout: 600000 },
  async () => {
    const config = await provider();
    const summaries: Summary[] = [];
    const outcomes: boolean[] = [];
    const memoryAttribution: Array<string | undefined> = [];
    for (const [variant, order] of [
      [false, true],
      [true, false],
    ].entries()) {
      for (const useMemory of order) {
        const { fixture, blocks } = recallFixture(variant, useMemory);
        const { summary } = await runEvaluationArm({
          arm: 'work',
          config,
          fixture,
          knownMemory: blocks,
        });
        outcomes.push(observe('recall', useMemory ? 'memory-on' : 'memory-off', variant, summary));
        summaries.push(summary);
        memoryAttribution.push(summary.firstRequestAttribution?.memoryAttribution);
      }
    }
    assertComparable(summaries);
    expect(memoryAttribution).toEqual(['absent', 'matched', 'matched', 'absent']);
    expect(outcomes.every(Boolean)).toBe(true);
  },
);

test.skipIf(!enabled || (group && group !== 'probe'))(
  'measures first-request provider token marginals with one output token',
  { timeout: 300000 },
  async () => {
    const config = await provider();
    const seed = (cwd: string) => csvFixture(cwd, 0);
    const native = await runEvaluationArm({
      arm: 'native',
      config,
      fixture: seed,
      captureFirst: true,
      captureOnly: true,
    });
    const work = await runEvaluationArm({
      arm: 'work',
      config,
      fixture: seed,
      captureFirst: true,
      captureOnly: true,
    });
    const memory = recallFixture(0, true);
    const remembered = await runEvaluationArm({
      arm: 'work',
      config,
      fixture: memory.fixture,
      captureFirst: true,
      captureOnly: true,
    });
    const { firstRequest: nativeRequest } = native;
    const { firstRequest: workRequest } = work;
    const { firstRequest: memoryRequest } = remembered;
    if (!nativeRequest || !workRequest || !memoryRequest)
      throw new Error('One or more synthetic captures missed the provider boundary.');
    const workNativePrompt = replaceWithNativeInstructions(
      workRequest,
      nativeRequest,
      native.cwd,
      work.cwd,
    );
    const variants = [
      { label: 'work-first-request', body: workRequest },
      { label: 'only-native-instructions', body: workNativePrompt },
      { label: 'only-shared-schemas', body: removeWorkOnlySchemas(workRequest) },
      {
        label: 'native-instructions-and-shared-schemas',
        body: removeWorkOnlySchemas(workNativePrompt),
      },
      ...(!candidate
        ? [
            { label: 'only-targeted-prompt-cut', body: removePromptDuplicates(workRequest) },
            {
              label: 'only-scheduler-cut',
              body: removePromptDuplicates(workRequest, PromptCut.Scheduled),
            },
            {
              label: 'only-checkpoint-cut',
              body: removePromptDuplicates(workRequest, PromptCut.Checkpoint),
            },
          ]
        : []),
      { label: 'memory-present', body: memoryRequest },
      { label: 'memory-removed', body: removeMemory(memoryRequest, memory.blocks) },
    ];
    const results: Array<{ status: number; observedModel?: string; inputTokens: number | null }> =
      [];
    for (const { label, body } of variants) {
      const metric = await probeInputTokens(config, body);
      reportEvaluationRow('PiWorkMarginal', { label, ...metric }, reportPath);
      results.push(metric);
    }
    for (const metric of results) {
      expect(metric.status).toBe(200);
      expect(metric.observedModel).toBeTruthy();
      expect(metric.inputTokens).toBeGreaterThan(0);
    }
    expect(new Set(results.map(metric => metric.observedModel)).size).toBe(1);
  },
);
