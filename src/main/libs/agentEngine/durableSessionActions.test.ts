import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, expect, test } from 'vitest';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { fauxAssistantMessage, fauxProvider } from '@earendil-works/pi-ai/providers/faux';
import { UserEntry } from '@earendil-works/pi-durable';
import { DurableModelCatalog } from './durableModelCatalog.mjs';
import { DurableSession } from './durableSession.mjs';
import { RuntimeConfiguration } from './durableSessionMetadata.mjs';

const context = BACKGROUND_CONTEXT;
const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

async function fixture() {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'durable-actions-'));
  cleanup.push(() => rm(cwd, { recursive: true, force: true }));
  const faux = fauxProvider();
  const catalog = new DurableModelCatalog();
  catalog.models.setProvider(faux.provider);
  const open = async () => {
    const session = await DurableSession.open({
      cwd,
      durableFile: path.join(cwd, 'execution.sqlite'),
      model: faux.getModel() as unknown as Record<string, unknown>,
      modelRuntime: catalog,
    });
    cleanup.push(() => session.close());
    return session;
  };
  return { faux, open };
}

test('native context replace/omit edits change the real model request without changing source journal', async () => {
  const f = await fixture();
  f.faux.setResponses([fauxAssistantMessage('First assistant response.')]);
  const session = await f.open();
  await session.prompt('ORIGINAL_USER_PRIVATE_ALPHA');
  const { conversation } = session.getDurableHost();
  const before = (await conversation.entries({}, 100, undefined, context)).items;
  const source = before.find(entry =>
    entry.model?.some(
      message =>
        message.role === 'user' &&
        JSON.stringify(message.content).includes('ORIGINAL_USER_PRIVATE_ALPHA'),
    ),
  )!;
  expect(source).toBeDefined();
  const replacedId = await session.appendContextEdit(String(source.id), {
    content: 'REPLACED_USER_ALPHA',
  });
  const edited = (await conversation.entries({}, 100, undefined, context)).items;
  const edit = edited.find(entry => String(entry.id) === replacedId)!;
  expect(edit.kind).toBe('zhiyuan.context-edit');
  expect(edit.edits).toEqual([
    {
      action: 'replace',
      target: source.id,
      messages: source.model!.map(message => ({ ...message, content: 'REPLACED_USER_ALPHA' })),
    },
  ]);
  expect(edited.find(entry => entry.id === source.id)).toEqual(source);
  let actualRequest = '';
  f.faux.setResponses([
    request => {
      actualRequest = JSON.stringify(request.messages);
      return fauxAssistantMessage('Replacement observed.');
    },
  ]);
  await session.prompt('Read the replaced context.');
  expect(actualRequest).toContain('REPLACED_USER_ALPHA');
  expect(actualRequest).not.toContain('ORIGINAL_USER_PRIVATE_ALPHA');
  await session.appendContextEdit(String(source.id), null);
  const projected = JSON.stringify((await conversation.context(context)).messages);
  expect(projected).not.toContain('REPLACED_USER_ALPHA');
  expect(projected).not.toContain('ORIGINAL_USER_PRIVATE_ALPHA');
  const raw = (await conversation.entries({}, 100, undefined, context)).items;
  expect(raw.find(entry => entry.id === source.id)).toEqual(source);
  expect(raw.filter(entry => before.some(original => original.id === entry.id))).toEqual(before);
});

test('fork persists its active conversation identity and reopens the selected branch', async () => {
  const f = await fixture();
  const session = await f.open();
  f.faux.setResponses([fauxAssistantMessage('ANCHOR_ASSISTANT')]);
  await session.prompt('ANCHOR_USER');
  const original = session.getDurableHost().conversation;
  const initial = (await original.entries({}, 100, undefined, context)).items;
  const anchor = initial.find(entry => entry.model?.some(message => message.role === 'assistant'))!;
  f.faux.setResponses([fauxAssistantMessage('DISCARDED_FUTURE_ASSISTANT')]);
  await session.prompt('DISCARDED_FUTURE_USER');
  const oldJournal = (await original.entries({}, 100, undefined, context)).items;
  await expect(session.navigateTree(String(anchor.id))).resolves.toEqual({ cancelled: false });
  const fork = session.getDurableHost().conversation;
  expect(fork.id).not.toBe(original.id);
  expect(
    (await session.getDurableHost().harness.snapshot(RuntimeConfiguration, context))
      ?.conversationId,
  ).toBe(fork.id);
  const branchContext = JSON.stringify((await fork.context(context)).messages);
  expect(branchContext).toContain('ANCHOR_USER');
  expect(branchContext).toContain('ANCHOR_ASSISTANT');
  expect(branchContext).not.toContain('DISCARDED_FUTURE');
  const ancestor = initial.find(entry => entry.model?.some(message => message.role === 'user'))!;
  await session.appendContextEdit(String(ancestor.id), { content: 'EDITED_INHERITED_USER' });
  const future = oldJournal.find(entry =>
    entry.model?.some(message => JSON.stringify(message.content).includes('DISCARDED_FUTURE_USER')),
  )!;
  await expect(session.appendContextEdit(String(future.id), null)).rejects.toThrow(/active branch/);
  expect(JSON.stringify((await fork.context(context)).messages)).toContain('EDITED_INHERITED_USER');
  f.faux.setResponses([fauxAssistantMessage('FORK_NEW_ANSWER')]);
  await session.prompt('FORK_NEW_USER');
  expect((await original.entries({}, 100, undefined, context)).items).toEqual(oldJournal);
  const forkId = fork.id;
  await session.close();
  const reopened = await f.open();
  expect(reopened.getDurableHost().conversation.id).toBe(forkId);
  let actualRequest = '';
  f.faux.setResponses([
    request => {
      actualRequest = JSON.stringify(request.messages);
      return fauxAssistantMessage('Branch restored.');
    },
  ]);
  await reopened.prompt('Continue on the selected branch.');
  expect(actualRequest).toContain('FORK_NEW_USER');
  expect(actualRequest).toContain('FORK_NEW_ANSWER');
  expect(actualRequest).not.toContain('DISCARDED_FUTURE');
  expect(actualRequest).toContain('EDITED_INHERITED_USER');
  expect(actualRequest).not.toContain('ANCHOR_USER');
});

test('role-safe assistant/tool-result replacements survive real HTTP serialization and reject malformed content', async () => {
  const cwd = await mkdtemp(path.join(os.tmpdir(), 'durable-edit-http-'));
  cleanup.push(() => rm(cwd, { recursive: true, force: true }));
  let calls = 0;
  let continuedPayload = '';
  const serverErrors: unknown[] = [];
  const server = createServer((request, response) => {
    void (async () => {
      const buffers: Buffer[] = [];
      for await (const chunk of request) buffers.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(buffers).toString());
      if (++calls === 3) continuedPayload = JSON.stringify(body.messages);
      const tool = calls === 1;
      const delta = tool
        ? {
            role: 'assistant',
            tool_calls: [
              {
                index: 0,
                id: 'write-source',
                type: 'function',
                function: {
                  name: 'write',
                  arguments: JSON.stringify({ path: 'source.txt', content: 'source' }),
                },
              },
            ],
          }
        : {
            role: 'assistant',
            content: calls === 2 ? 'ORIGINAL_ASSISTANT_ALPHA' : 'HTTP continuation accepted.',
          };
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write(
        `data: ${JSON.stringify({ id: 'edit', model: 'edit', choices: [{ index: 0, delta, finish_reason: null }] })}\n\n`,
      );
      response.end(
        `data: ${JSON.stringify({
          id: 'edit',
          model: 'edit',
          choices: [{ index: 0, delta: {}, finish_reason: tool ? 'tool_calls' : 'stop' }],
          usage: { prompt_tokens: 300, completion_tokens: 20, total_tokens: 320 },
        })}\n\ndata: [DONE]\n\n`,
      );
    })().catch(error => {
      serverErrors.push(error);
      response.destroy();
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  cleanup.push(
    () =>
      new Promise<void>(resolve => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  );
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  const model = {
    id: 'edit',
    name: 'Edit',
    provider: 'native-edit',
    api: 'openai-completions',
    baseUrl,
    reasoning: false,
    input: ['text'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 16384,
    maxTokens: 1024,
  };
  const catalog = new DurableModelCatalog();
  catalog.registerProvider(model.provider, { api: model.api, baseUrl, models: [model] });
  await catalog.setRuntimeApiKey(model.provider, 'local-test');
  const session = await DurableSession.open({
    cwd,
    durableFile: path.join(cwd, 'native.sqlite'),
    model,
    modelRuntime: catalog,
    tools: ['write'],
  });
  cleanup.push(() => session.close());
  await session.prompt('Write the source file.');
  const { conversation } = session.getDurableHost();
  const before = (await conversation.entries({}, 100, undefined, context)).items;
  const assistant = before.find(entry =>
    entry.model?.some(
      message =>
        message.role === 'assistant' &&
        JSON.stringify(message.content).includes('ORIGINAL_ASSISTANT_ALPHA'),
    ),
  )!;
  const tool = before.find(entry => entry.model?.some(message => message.role === 'toolResult'))!;
  for (const content of [
    { type: 'text', text: 'not an array' },
    [{ type: 'text', text: 42 }],
    [{ type: 'image', data: 'x', mimeType: 'image/png' }],
    [{ type: 'toolCall', id: 'bad', name: 'read', arguments: [] }],
    [{ type: 'thinking', thinking: 'x', redacted: 'yes' }],
  ]) {
    await expect(session.appendContextEdit(String(assistant.id), { content })).rejects.toThrow(
      /Invalid replacement content/,
    );
  }
  await expect(
    session.appendContextEdit(String(tool.id), {
      content: [{ type: 'thinking', thinking: 'invalid tool result' }],
    }),
  ).rejects.toThrow(/Invalid replacement content/);
  expect((await conversation.entries({}, 100, undefined, context)).items).toEqual(before);
  await session.appendContextEdit(String(assistant.id), { content: 'EDITED_ASSISTANT_ALPHA' });
  await session.appendContextEdit(String(tool.id), { content: 'EDITED_TOOL_OUTPUT' });
  const projected = (await conversation.context(context)).messages;
  expect(
    projected.find(
      message =>
        message.role === 'assistant' &&
        JSON.stringify(message.content).includes('EDITED_ASSISTANT_ALPHA'),
    )?.content,
  ).toEqual([{ type: 'text', text: 'EDITED_ASSISTANT_ALPHA' }]);
  expect(projected.find(message => message.role === 'toolResult')?.content).toEqual([
    { type: 'text', text: 'EDITED_TOOL_OUTPUT' },
  ]);
  await session.prompt('Continue using the edited context.');
  expect(continuedPayload).toContain('EDITED_ASSISTANT_ALPHA');
  expect(continuedPayload).toContain('EDITED_TOOL_OUTPUT');
  expect(continuedPayload).not.toContain('ORIGINAL_ASSISTANT_ALPHA');
  const after = (await conversation.entries({}, 100, undefined, context)).items;
  for (const source of before) expect(after.find(entry => entry.id === source.id)).toEqual(source);
  expect(serverErrors).toEqual([]);
  expect(calls).toBe(3);
});

test('foreign conversation entries are rejected and failed navigation leaves observation active', async () => {
  const f = await fixture();
  const session = await f.open();
  f.faux.setResponses([fauxAssistantMessage('Local answer.')]);
  await session.prompt('Local user.');
  const { harness, conversation } = session.getDurableHost();
  const foreign = await harness.commit(async tx => {
    const created = await tx.createConversation({ ownership: { kind: 'ownerless' } });
    return tx.appendEntry(created.id, {
      kind: UserEntry.kind,
      model: [{ role: 'user', content: 'FOREIGN_OWNER_SECRET', timestamp: 1 }],
    });
  }, context);
  const before = (await conversation.entries({}, 100, undefined, context)).items;
  await expect(session.appendContextEdit(String(foreign.id), null)).rejects.toThrow(
    /another conversation/i,
  );
  await expect(session.navigateTree(String(foreign.id))).rejects.toThrow();
  expect(session.getDurableHost().conversation.id).toBe(conversation.id);
  expect((await conversation.entries({}, 100, undefined, context)).items).toEqual(before);
  expect(await harness.snapshot(RuntimeConfiguration, context)).toBeUndefined();
  const settled: string[] = [];
  session.subscribe(event => {
    if (event.type === 'agent_settled') settled.push(event.type);
  });
  f.faux.setResponses([fauxAssistantMessage('Still observed.')]);
  await session.prompt('Continue after invalid navigation.');
  expect(settled).toHaveLength(1);
});
