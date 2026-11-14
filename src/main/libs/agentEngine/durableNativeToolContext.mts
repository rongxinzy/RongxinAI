import type { ToolRegistration } from '@earendil-works/pi-durable';
import { runWithDurableInvocation } from './durableInvocation.mjs';

/** Host services receive cancellation from the actual native tool invocation. */
export function bindNativeToolContext<T extends ToolRegistration>(tool: T): T {
  return {
    ...tool,
    execute: (args, api, context) =>
      runWithDurableInvocation(api, context, () => tool.execute(args, api, context)),
  } as T;
}
