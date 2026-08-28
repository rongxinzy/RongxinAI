import { expect, test } from 'vitest';

import { BuiltinCodingDriver } from './builtinCodingDriver';

test('starts the in-process runtime while the room owns streamed event projection', async () => {
  const calls: string[] = [];
  const driver = new BuiltinCodingDriver({
    start: async sessionId => {
      calls.push(sessionId);
    },
    cancel: async sessionId => {
      calls.push(`cancel:${sessionId}`);
    },
  });
  const session = await driver.createSession({ workspaceRoot: '/workspace' });
  const events = [];
  for await (const event of driver.prompt({
    sessionId: session.id,
    workspaceRoot: '/workspace',
    prompt: 'work',
  }))
    events.push(event);
  expect((await driver.getCapabilities()).supportsFilesystem).toBe(true);
  expect(events).toEqual([]);
  await driver.cancel(session.id);
  expect(calls).toEqual([session.id, `cancel:${session.id}`]);
});

test('forwards the selected model to the in-process runtime', async () => {
  const received: string[] = [];
  const driver = new BuiltinCodingDriver({
    start: async (_sessionId, _workspaceRoot, _prompt, modelOverride) => {
      if (modelOverride) received.push(modelOverride);
    },
    cancel: async () => undefined,
  });
  const session = await driver.createSession({ workspaceRoot: '/workspace' });

  for await (const _event of driver.prompt({
    sessionId: session.id,
    workspaceRoot: '/workspace',
    prompt: 'work',
    modelOverride: 'deepseek/deepseek-v4-pro',
  })) {
    // The built-in runtime owns the stream projection.
  }

  expect(received).toEqual(['deepseek/deepseek-v4-pro']);
});
