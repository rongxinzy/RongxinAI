import { mkdtemp, readdir, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { afterEach } from 'vitest';
import { fauxProvider } from '@earendil-works/pi-ai/providers/faux';
import { Type } from 'typebox';
import { DurableSession } from '../libs/agentEngine/durableSession.mjs';
import { DurableModelCatalog } from '../libs/agentEngine/durableModelCatalog.mjs';
import { DeliveryMode, PayloadKind, SessionTarget, WakeMode } from '../../scheduledTask/constants';
import type { ScheduledTaskInput } from '../../scheduledTask/types';
import { DurableAutomationService } from './durableAutomationService.mjs';

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

export async function fixture(tokensPerSecond?: number) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'native-automation-'));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const faux = fauxProvider({ ...(tokensPerSecond ? { tokensPerSecond } : {}) });
  const catalog = new DurableModelCatalog();
  catalog.models.setProvider(faux.provider);
  let unavailable = false;
  let effects = 0;
  const opens = new Map<string, DurableSession>();
  const options = {
    listSessionFiles: async () =>
      (await readdir(root))
        .filter(file => file.endsWith('.sqlite'))
        .map(file => path.join(root, file)),
    fileForSession: (id: string) => path.join(root, `${id.replace(':', '-')}.sqlite`),
    openAutomationSession: async (_job: unknown, file: string) => {
      if (unavailable) throw new Error('Selected model is unavailable.');
      const session = await DurableSession.open({
        cwd: root,
        durableFile: file,
        modelRuntime: catalog,
        model: faux.getModel() as unknown as Record<string, unknown>,
        customTools: [
          {
            name: 'effect',
            label: 'Effect',
            description: 'Record an external effect.',
            parameters: Type.Object({}),
            execute: async () => {
              effects++;
              return { content: [{ type: 'text', text: 'effect saved' }] };
            },
          },
        ],
      });
      opens.set(file, session);
      return session;
    },
  };
  const createService = () => {
    const service = new DurableAutomationService(options);
    cleanup.push(() => service.stop());
    return service;
  };
  return {
    root,
    faux,
    options,
    createService,
    effects: () => effects,
    opens,
    setUnavailable: (value: boolean) => {
      unavailable = value;
    },
  };
}

export const input = (overrides: Partial<ScheduledTaskInput> = {}): ScheduledTaskInput => ({
  name: 'Native task',
  description: '',
  enabled: false,
  schedule: { kind: 'every', everyMs: 60_000 },
  sessionTarget: SessionTarget.Task,
  wakeMode: WakeMode.Now,
  payload: { kind: PayloadKind.AgentTurn, message: 'Run the task.' },
  delivery: { mode: DeliveryMode.None },
  ...overrides,
});
