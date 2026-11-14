import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { createModels } from '@earendil-works/pi-ai';
import {
  createRegistry,
  defineDoc,
  Harness,
  ROOT_CONVERSATION_ID,
  type JsonObject,
} from '@earendil-works/pi-durable';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';

/** Launch configuration is durable data, separate from product transcript projections. */
export const RuntimeConfiguration = defineDoc<{ options: JsonObject; conversationId: number }>({
  kind: 'zhiyuan.execution.configuration',
  version: 1,
  scope: 'session',
  initial: () => ({ options: {}, conversationId: ROOT_CONVERSATION_ID }),
  checkpointWhen: () => true,
});

/** Persist current resource choices so a restarted pending input uses the latest configuration. */
export async function updateDurableRuntimeOptions(
  harness: Harness,
  change: Record<string, unknown>,
): Promise<void> {
  await harness.commit(async tx => {
    const document = await tx.doc(RuntimeConfiguration);
    for (const [key, value] of Object.entries(change)) {
      if (value === undefined) delete document.options[key];
      else document.options[key] = JSON.parse(JSON.stringify(value));
    }
  }, BACKGROUND_CONTEXT);
}

export async function readDurableRecovery(file: string) {
  const storage = await openNodeSqliteStorage(file);
  const context = BACKGROUND_CONTEXT;
  let harness: Harness | undefined;
  try {
    harness = await Harness.open(
      storage,
      { models: createModels(), registry: createRegistry(), readOnly: true },
      context,
    );
    const [inspection, configuration] = await Promise.all([
      harness.inspect(context),
      harness.snapshot(RuntimeConfiguration, context),
    ]);
    return { pending: inspection.submissions.length > 0, options: configuration?.options ?? {} };
  } finally {
    if (harness) await harness.close(context);
    else await storage.close(context);
  }
}
