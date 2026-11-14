import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from '@earendil-works/pi-ai/providers/faux';
import { DurableSession } from './durableSession.mjs';
import { DurableModelCatalog } from './durableModelCatalog.mjs';
import type { ToolDefinition } from './durableToolTypes';
import type { PiEvent } from './piRuntimeSessionState';

/** Real native generation/tool tasks, with only model I/O replaced by a scripted provider. */
export async function runDurableToolForTest(
  tool: ToolDefinition,
  args: Record<string, unknown>,
): Promise<PiEvent[]> {
  const faux = fauxProvider();
  const catalog = new DurableModelCatalog();
  catalog.models.setProvider(faux.provider);
  faux.setResponses([
    fauxAssistantMessage(fauxToolCall(tool.name, args, { id: 'call' }), { stopReason: 'toolUse' }),
    fauxAssistantMessage('Done.'),
  ]);
  const session = await DurableSession.open({
    cwd: process.cwd(),
    model: faux.getModel() as unknown as Record<string, unknown>,
    modelRuntime: catalog,
    customTools: [tool],
    tools: [tool.name],
  });
  const events: PiEvent[] = [];
  session.subscribe(event => events.push(event));
  try {
    await session.prompt('Execute the requested tool.');
  } finally {
    await session.close();
  }
  return events;
}
