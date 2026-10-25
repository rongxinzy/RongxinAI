import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, test } from 'vitest';
import { DesktopPetBuiltinId } from '../../shared/desktopPet/catalog';
import { CompanionRequestState } from '../../shared/companion/constants';
import { MemoryKind } from '../../shared/memory';
import { MagpieModelService } from '../magpie/modelService';
import { EngramManager } from '../memory/engramManager';
import { MemoryRepository } from '../memory/repository';
import { ProjectMemoryService } from '../memory/projectMemoryService';
import { resolveProjectIdentity } from '../memory/projectIdentity';
import { ZhiYuanEngramAdapter } from '../memory/zhiyuanEngramAdapter';
import { CompanionMemoryService } from './memory';
import { CompanionMemoryRetractions } from './memoryRetractions';
import { CompanionMemoryTool } from './constants';
import { CompanionModelAssignment } from './modelAssignment.mjs';
import { PiCompanionRuntime } from './durableRuntime.mjs';

interface Request {
  model: string;
  tools?: { function: { name: string } }[];
  messages: { role: string; content: unknown }[];
}

/** Production runtime + Magpie assignment + actual Engram, with a synthetic local provider. */
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'companion-durable-memory-'));
  const db = new Database(path.join(root, 'projection.sqlite'));
  const manager = new EngramManager({ userDataPath: root, projectRoot: process.cwd() });
  const adapter = new ZhiYuanEngramAdapter(manager);
  const repository = new MemoryRepository(db);
  const shared = new ProjectMemoryService(repository, adapter, resolveProjectIdentity, root);
  const memory = new CompanionMemoryService(
    repository,
    adapter,
    shared,
    root,
    new CompanionMemoryRetractions(db),
  );
  const requests: Request[] = [];
  let operation: { name: string; arguments: object } | null = null;
  let rejectTools = false;
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const part of req) body += part.toString();
    const request: Request = JSON.parse(body);
    requests.push(request);
    if (rejectTools && request.tools?.length) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'This model does not support tools' } }));
      return;
    }
    const call = operation;
    operation = null;
    const delta = call
      ? {
          role: 'assistant',
          tool_calls: [
            {
              index: 0,
              id: 'reused-call',
              type: 'function',
              function: { name: call.name, arguments: JSON.stringify(call.arguments) },
            },
          ],
        }
      : { role: 'assistant', content: 'Fixture finished' };
    const chunk = (value: object, reason: string | null) =>
      `data: ${JSON.stringify({
        id: 'fixture',
        object: 'chat.completion.chunk',
        model: request.model,
        choices: [{ index: 0, delta: value, finish_reason: reason }],
      })}\n\n`;
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(chunk(delta, null) + chunk({}, call ? 'tool_calls' : 'stop') + 'data: [DONE]\n\n');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture port unavailable');
  const service = new MagpieModelService(
    {
      status: () => ({
        state: 'running',
        version: 'fixture',
        gatewayUrl: `http://127.0.0.1:${address.port}`,
      }),
      models: async () => [{ id: 'memory-model', native_endpoints: ['/v1/chat/completions'] }],
    },
    {
      readDefaultModelId: () => null,
      writeDefaultModelId: () => {
        throw new Error('Default changed');
      },
    },
  );
  const assignment = new CompanionModelAssignment(service);
  const runtime = new PiCompanionRuntime(root, assignment, memory);
  const profile = {
    petId: randomUUID(),
    personaId: DesktopPetBuiltinId.Youli,
    characterId: DesktopPetBuiltinId.Youli,
    createdAt: Date.now(),
  };
  const run = async (name?: string, args: object = {}, owner = profile) => {
    operation = name ? { name, arguments: args } : null;
    const result = await runtime.submit(owner, randomUUID(), 'Synthetic paper kite request');
    expect(result.receipt).not.toBeNull();
    await expect
      .poll(async () => (await runtime.answer(owner, result.receipt!)).state)
      .toBe(CompanionRequestState.Answered);
  };
  return {
    runtime,
    profile,
    memory,
    shared,
    requests,
    assignment,
    run,
    reject: () => {
      rejectTools = true;
    },
    cleanup: async () => {
      await runtime.close();
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
      await manager.stop();
      db.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

test('the production companion executes private memory operations through automatically assigned tools', async () => {
  const f = await fixture();
  try {
    const fact = {
      title: 'Paper kite',
      content: 'The paper kite is blue.',
      kind: MemoryKind.Preference,
    };
    await f.run(CompanionMemoryTool.Save, fact);
    const saved = f.memory.list(f.profile.petId)[0];
    expect(saved.content).toBe(fact.content);
    expect(f.requests[0].tools?.map(tool => tool.function.name)).toEqual(
      Object.values(CompanionMemoryTool),
    );
    expect((await f.runtime.resume(f.profile)).toolUse).toBe(true);
    await f.run(CompanionMemoryTool.Save, {
      ...fact,
      content: 'The paper kite is green.',
      replacesId: saved.id,
    });
    const corrected = f.memory.list(f.profile.petId)[0];
    expect(corrected.id).not.toBe(saved.id);
    expect(await f.memory.context(f.profile.petId, 'paper kite')).toContain('is green');
    await f.run(CompanionMemoryTool.Search, {}, { ...f.profile, petId: randomUUID() });
    const foreignResult = f.requests.at(-1)?.messages.findLast(message => message.role === 'tool');
    expect(JSON.parse(String(foreignResult?.content))).toEqual({ memories: [] });
    await f.run(CompanionMemoryTool.Forget, { id: corrected.id });
    expect(await f.memory.search(f.profile.petId)).toEqual([]);
    expect(f.shared.listManagedMemories()).toEqual([]);
    expect(f.requests.every(request => request.model === 'memory-model')).toBe(true);
  } finally {
    await f.cleanup();
  }
}, 60_000);

test('tool rejection does not replay a failed request and the next request retains text chat', async () => {
  const f = await fixture();
  try {
    f.reject();
    const admission = await f.runtime.submit(f.profile, 'rejected', 'Synthetic request');
    await expect
      .poll(async () => (await f.runtime.answer(f.profile, admission.receipt!)).state)
      .toBe(CompanionRequestState.Unanswered);
    expect(f.requests).toHaveLength(1);
    expect(f.assignment.permitsTools('memory-model')).toBe(false);
    await f.run();
    expect(f.requests).toHaveLength(2);
    expect(f.requests[1].tools ?? []).toEqual([]);
    expect(f.memory.list(f.profile.petId)).toEqual([]);
  } finally {
    await f.cleanup();
  }
}, 60_000);
