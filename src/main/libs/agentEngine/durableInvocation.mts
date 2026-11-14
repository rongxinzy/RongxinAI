import { AsyncLocalStorage } from 'node:async_hooks';
import type { Context } from '@earendil-works/chord/context';
import type { Harness, ToolExecutionApi } from '@earendil-works/pi-durable';

export interface DurableInvocation {
  api: ToolExecutionApi;
  context: Context;
  observeConversation?: Harness['observeConversation'];
}

const invocation = new AsyncLocalStorage<DurableInvocation>();

/** Carries the native tool ownership scope through application tool handlers. */
export function runWithDurableInvocation<T>(
  api: ToolExecutionApi,
  context: Context,
  operation: () => T,
  observeConversation?: Harness['observeConversation'],
): T {
  return invocation.run({ api, context, observeConversation }, operation);
}

export function getDurableInvocation(): DurableInvocation {
  const current = invocation.getStore();
  if (!current) throw new Error('Agent delegation requires a Durable tool invocation.');
  return current;
}

export function currentDurableInvocation(): DurableInvocation | undefined {
  return invocation.getStore();
}
