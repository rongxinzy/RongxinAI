import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DesktopPetBuiltinId } from '../../src/shared/desktopPet/catalog';
import type { CompanionProfile } from '../../src/shared/companion/types';
import { MagpieModelService } from '../../src/main/magpie/modelService';
import { CompanionModelAssignment } from '../../src/main/companion/modelAssignment.mjs';
import { PiCompanionRuntime } from '../../src/main/companion/durableRuntime.mjs';

export async function companionRuntimeFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'zhiyuan-companion-'));
  const requests: { messages: { role: string; content: unknown }[]; model: string }[] = [];
  let hold = false;
  let available = true;
  let failLocal = false;
  let vision = false;
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
              ...(vision
                ? [
                    {
                      id: 'vision',
                      native_endpoints: ['/v1/chat/completions'],
                      modalities: { input: ['text', 'image'], output: ['text'] },
                    },
                  ]
                : []),
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
  const create = (memory?: { context(petId: string, query: string): Promise<string> }) => {
    const runtime = new PiCompanionRuntime(root, new CompanionModelAssignment(service), memory);
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
    vision: (value = true) => {
      vision = value;
    },
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
