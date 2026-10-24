import { createServer } from 'node:http';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { DesktopPetBuiltinId } from '../../shared/desktopPet/catalog';
import { CompanionCapability, CompanionRequestState } from '../../shared/companion/constants';
import type { CompanionProfile, CompanionReceipt } from '../../shared/companion/types';
import { MagpieModelService } from '../magpie/modelService';
import { CompanionModelAssignment } from './modelAssignment.mjs';
import { PiCompanionRuntime } from './durableRuntime.mjs';

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'zhiyuan-companion-'));
  const requests: { messages: { role: string; content: unknown }[]; model: string }[] = [];
  let hold = false;
  let available = true;
  let failLocal = false;
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk.toString();
    const request = JSON.parse(body);
    requests.push(request);
    if (failLocal && request.model === 'local') {
      res.writeHead(429, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({ error: { message: 'Fixture quota exhausted', type: 'rate_limit_error' } }),
      );
      return;
    }
    if (hold) return;
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const chunk = (delta: object, finish_reason: string | null) =>
      `data: ${JSON.stringify({ id: 'reply', object: 'chat.completion.chunk', created: 1, model: 'local', choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
    res.end(
      chunk({ role: 'assistant', content: 'A real persisted answer' }, null) +
        chunk({}, 'stop') +
        'data: [DONE]\n\n',
    );
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing fixture port');
  const service = new MagpieModelService(
    {
      status: () => ({
        state: 'running',
        version: 'test',
        gatewayUrl: `http://127.0.0.1:${address.port}`,
      }),
      models: async () =>
        available
          ? [
              { id: 'local', native_endpoints: ['/v1/chat/completions'] },
              { id: 'backup', native_endpoints: ['/v1/chat/completions'] },
            ]
          : [],
    },
    {
      readDefaultModelId: () => 'local',
      writeDefaultModelId: () => {
        throw new Error('Must not change default');
      },
    },
  );
  const runtimes: PiCompanionRuntime[] = [];
  const create = () => {
    const runtime = new PiCompanionRuntime(root, new CompanionModelAssignment(service));
    runtimes.push(runtime);
    return runtime;
  };
  const profile: CompanionProfile = {
    petId: randomUUID(),
    personaId: DesktopPetBuiltinId.Youli,
    characterId: DesktopPetBuiltinId.Youli,
    createdAt: Date.now(),
  };
  return {
    root,
    profile,
    requests,
    create,
    hold: (value: boolean) => {
      hold = value;
    },
    available: (value: boolean) => {
      available = value;
    },
    failLocal: () => {
      failLocal = true;
    },
    cleanup: async () => {
      await Promise.all(runtimes.map(runtime => runtime.close()));
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
      await rm(root, { recursive: true, force: true });
    },
  };
}

async function receiptFor(runtime: PiCompanionRuntime, profile: CompanionProfile, key = 'one') {
  const admitted = await runtime.submit(profile, key, 'Help me think through this.');
  expect(admitted.receipt).not.toBeNull();
  return admitted.receipt!;
}

async function answered(
  runtime: PiCompanionRuntime,
  profile: CompanionProfile,
  receipt: CompanionReceipt,
) {
  await expect
    .poll(async () => (await runtime.answer(profile, receipt)).state)
    .toBe(CompanionRequestState.Answered);
  expect((await runtime.answer(profile, receipt)).text).toBe('A real persisted answer');
}

test('persists real SQLite receipts and history, reopening does not repeat the model request', async () => {
  const f = await fixture();
  try {
    const runtime = f.create();
    const receipt = await receiptFor(runtime, f.profile);
    await answered(runtime, f.profile, receipt);
    expect((await stat(path.join(f.root, `${f.profile.petId}.sqlite`))).size).toBeGreaterThan(0);
    await runtime.close();
    const reopened = f.create();
    await answered(reopened, f.profile, receipt);
    expect(
      (await reopened.submit(f.profile, 'one', 'Retry after losing the receipt.')).receipt,
    ).toEqual(receipt);
    expect(f.requests).toHaveLength(1);
    expect(JSON.stringify(f.requests[0].messages)).toContain('Youli');
    const next = await receiptFor(
      reopened,
      { ...f.profile, characterId: DesktopPetBuiltinId.Maixiao },
      'two',
    );
    await answered(reopened, f.profile, next);
    expect(JSON.stringify(f.requests[1].messages)).toContain('A real persisted answer');
    expect(JSON.stringify(f.requests[1].messages)).toContain('Youli');
  } finally {
    await f.cleanup();
  }
});

test('pauses on close, resumes unfinished input after reopen, and keeps request identity', async () => {
  const f = await fixture();
  try {
    f.hold(true);
    const runtime = f.create();
    const receipt = await receiptFor(runtime, f.profile);
    await expect.poll(() => f.requests.length).toBe(1);
    await runtime.close();
    const reopened = f.create();
    expect((await reopened.answer(f.profile, receipt)).state).toBe(CompanionRequestState.Accepted);
    f.available(false);
    expect((await reopened.resume(f.profile)).capability).toBe(CompanionCapability.Local);
    expect((await reopened.answer(f.profile, receipt)).state).toBe(CompanionRequestState.Accepted);
    f.available(true);
    f.hold(false);
    await reopened.resume(f.profile);
    await answered(reopened, f.profile, receipt);
    expect((await reopened.submit(f.profile, 'one', 'retry')).receipt).toEqual(receipt);
    expect(f.requests).toHaveLength(2);
  } finally {
    await f.cleanup();
  }
});

test('explicit stop withdraws work and a later reopen cannot restart it', async () => {
  const f = await fixture();
  try {
    f.hold(true);
    const runtime = f.create();
    const receipt = await receiptFor(runtime, f.profile);
    await expect.poll(() => f.requests.length).toBe(1);
    await runtime.stop(f.profile);
    expect((await runtime.answer(f.profile, receipt)).state).toBe(CompanionRequestState.Unanswered);
    await runtime.close();
    const reopened = f.create();
    await reopened.resume(f.profile);
    expect((await reopened.answer(f.profile, receipt)).state).toBe(
      CompanionRequestState.Unanswered,
    );
    expect(f.requests).toHaveLength(1);
  } finally {
    await f.cleanup();
  }
});

test('no model does not acknowledge or persist an unaccepted user draft', async () => {
  const f = await fixture();
  try {
    const runtime = f.create();
    f.available(false);
    expect(await runtime.submit(f.profile, 'draft', 'Keep this text')).toMatchObject({
      receipt: null,
      availability: { capability: CompanionCapability.Local },
    });
    expect(f.requests).toHaveLength(0);
    f.available(true);
    const receipt = await receiptFor(runtime, f.profile, 'draft');
    await answered(runtime, f.profile, receipt);
  } finally {
    await f.cleanup();
  }
});

test('prevents duplicate storage owners and validates receipt ownership', async () => {
  const f = await fixture();
  try {
    const runtime = f.create();
    const receipt = await receiptFor(runtime, f.profile);
    await answered(runtime, f.profile, receipt);
    await expect(f.create().resume(f.profile)).rejects.toThrow('already has an owner');
    await expect(runtime.answer(f.profile, { ...receipt, petId: randomUUID() })).rejects.toThrow(
      'another companion',
    );
    await expect(
      runtime.answer(f.profile, { ...receipt, submissionId: receipt.submissionId + 1 }),
    ).rejects.toThrow('Unknown');
  } finally {
    await f.cleanup();
  }
});

test('switching companions isolates transcripts and does not use appearances as storage keys', async () => {
  const f = await fixture();
  try {
    const runtime = f.create();
    const first = await receiptFor(runtime, f.profile);
    await answered(runtime, f.profile, first);
    const other = { ...f.profile, petId: randomUUID(), personaId: DesktopPetBuiltinId.Mianmian };
    const second = await receiptFor(runtime, other);
    await answered(runtime, other, second);
    expect(JSON.stringify(f.requests[1].messages)).not.toContain('A real persisted answer');
    expect(JSON.stringify(f.requests[1].messages)).toContain('Mianmian');
    await answered(runtime, f.profile, first);
    await expect(runtime.resume({ ...f.profile, petId: '../outside' })).rejects.toThrow();
  } finally {
    await f.cleanup();
  }
});

test('actual provider failure cools down that model without replaying the user request', async () => {
  const f = await fixture();
  try {
    f.failLocal();
    const runtime = f.create();
    const failed = await receiptFor(runtime, f.profile);
    await expect
      .poll(async () => (await runtime.answer(f.profile, failed)).state)
      .toBe(CompanionRequestState.Unanswered);
    expect(f.requests).toHaveLength(1);
    const next = await receiptFor(runtime, f.profile, 'next');
    await answered(runtime, f.profile, next);
    expect(f.requests.map(request => request.model)).toEqual(['local', 'backup']);
    expect((await runtime.answer(f.profile, failed)).state).toBe(CompanionRequestState.Unanswered);
    expect((await runtime.resume(f.profile)).modelId).toBe('backup');
  } finally {
    await f.cleanup();
  }
});
