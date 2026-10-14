import type {
  AepProtectedStorage,
  AepRequest,
  AepResponse,
  AepTransport,
  HeartbeatResponse,
  JsonObject,
} from '@aep/sdk-node';
import { AepProblem } from '@aep/sdk-node';
import { describe, expect, test, vi } from 'vitest';
import {
  isUnknownSessionClientProblem,
  ZHIYUAN_SESSION_CLIENT_NAME,
  ZHIYUAN_SESSION_CLIENT_VERSION,
} from './client-identity.js';
import { createZhiyuanAepClient } from './factory.js';

const AGENT_ID = '7b7d02c4-2c4f-4f6f-9d3c-9d6f8a1b2c3d';

describe('Zhiyuan session client identity', () => {
  test('reports the extension identity on login and heartbeat', async () => {
    const fixture = fixtureTransport();
    const client = createClient(fixture.transport);

    await client.loginWithPassword(credentials());
    await client.heartbeat({ status: 'online' });

    const login = fixture.requests.at(0);
    expect(login?.path).toBe('/aep/v1/auth/password/login');
    expect(login?.body.client).toEqual({
      name: ZHIYUAN_SESSION_CLIENT_NAME,
      version: ZHIYUAN_SESSION_CLIENT_VERSION,
      deviceId: AGENT_ID,
    });
    expect(ZHIYUAN_SESSION_CLIENT_VERSION).toMatch(/^\d+\.\d+\.\d+/);

    const heartbeat = fixture.requests.at(1);
    expect(heartbeat?.path).toBe('/aep/v1/user/heartbeat');
    expect(heartbeat?.body).toMatchObject({
      status: 'online',
      client: {
        name: ZHIYUAN_SESSION_CLIENT_NAME,
        version: ZHIYUAN_SESSION_CLIENT_VERSION,
        deviceId: AGENT_ID,
      },
    });
    expect(fixture.requests).toHaveLength(2);
  });

  test('retries login without the identity on older servers and remembers the result', async () => {
    const fixture = fixtureTransport({ rejectClient: true });
    const client = createClient(fixture.transport);

    const tokens = await client.loginWithPassword(credentials());
    expect(tokens.accessToken).toBe('access-token');

    const logins = fixture.requests.filter(
      request => request.path === '/aep/v1/auth/password/login',
    );
    expect(logins).toHaveLength(2);
    expect(logins[0]?.body.client).toBeDefined();
    expect(logins[1]?.body.client).toBeUndefined();

    // The support probe is shared with heartbeat: no second 400 round-trip.
    await client.heartbeat({ status: 'online' });
    const heartbeat = fixture.requests.at(-1);
    expect(heartbeat?.path).toBe('/aep/v1/user/heartbeat');
    expect(heartbeat?.body.client).toBeUndefined();
  });

  test('probes heartbeat support when the session was restored without a login', async () => {
    const fixture = fixtureTransport({ rejectClient: true });
    const client = createClient(fixture.transport);

    await client.heartbeat({ status: 'online' });
    let heartbeats = fixture.requests.filter(request => request.path === '/aep/v1/user/heartbeat');
    expect(heartbeats).toHaveLength(2);
    expect(heartbeats[0]?.body.client).toBeDefined();
    expect(heartbeats[1]?.body.client).toBeUndefined();

    await client.heartbeat({ status: 'online' });
    heartbeats = fixture.requests.filter(request => request.path === '/aep/v1/user/heartbeat');
    expect(heartbeats).toHaveLength(3);
    expect(heartbeats[2]?.body.client).toBeUndefined();

    // A later login skips the identity directly instead of probing again.
    await client.loginWithPassword(credentials());
    const login = fixture.requests.at(-1);
    expect(login?.path).toBe('/aep/v1/auth/password/login');
    expect(login?.body.client).toBeUndefined();
  });

  test('propagates credential failures without retrying or marking the server old', async () => {
    const fixture = fixtureTransport({ rejectCredentials: true });
    const client = createClient(fixture.transport);

    await expect(client.loginWithPassword(credentials())).rejects.toMatchObject({
      status: 401,
      code: 'INVALID_CREDENTIALS',
    });
    expect(fixture.requests).toHaveLength(1);

    fixture.options.rejectCredentials = false;
    await client.loginWithPassword(credentials());
    const retry = fixture.requests.at(-1);
    expect(retry?.body.client).toBeDefined();
  });

  test('does not retry heartbeat on problems unrelated to the client field', async () => {
    const fixture = fixtureTransport({ heartbeatStatus: 503 });
    const client = createClient(fixture.transport);

    await expect(client.heartbeat({ status: 'online' })).rejects.toMatchObject({ status: 503 });
    expect(fixture.requests).toHaveLength(1);
  });
});

describe('isUnknownSessionClientProblem', () => {
  test('matches only the unknown-field rejection shape', () => {
    expect(
      isUnknownSessionClientProblem(
        new AepProblem({
          type: 'about:blank',
          title: 'Bad Request',
          status: 400,
          code: 'INVALID_REQUEST',
        }),
      ),
    ).toBe(true);
    expect(
      isUnknownSessionClientProblem(
        new AepProblem({
          type: 'about:blank',
          title: 'Bad Request',
          status: 400,
          code: 'VALIDATION_FAILED',
        }),
      ),
    ).toBe(false);
    expect(
      isUnknownSessionClientProblem(
        new AepProblem({
          type: 'about:blank',
          title: 'Unauthorized',
          status: 401,
          code: 'INVALID_REQUEST',
        }),
      ),
    ).toBe(false);
    expect(isUnknownSessionClientProblem(new Error('network down'))).toBe(false);
  });
});

interface FixtureOptions {
  rejectClient?: boolean;
  rejectCredentials?: boolean;
  heartbeatStatus?: number;
}

interface FixtureRequest {
  readonly path: string;
  readonly body: JsonObject;
}

function createClient(transport: AepTransport) {
  const protectedStorage: AepProtectedStorage = {
    read: vi.fn(async () => null),
    write: vi.fn(async () => undefined),
    remove: vi.fn(async () => undefined),
  };
  return createZhiyuanAepClient({
    baseUrl: 'https://aep.example.test',
    agentId: AGENT_ID,
    agentVersion: '2026.8.0',
    platform: 'windows',
    protectedStorage,
    transport,
  });
}

function credentials() {
  return { deploymentId: 'enterprise-1', username: 'admin', password: 'secret' };
}

function fixtureTransport(options: FixtureOptions = {}): {
  readonly requests: FixtureRequest[];
  readonly transport: AepTransport;
  readonly options: FixtureOptions;
} {
  const requests: FixtureRequest[] = [];
  const transport: AepTransport = {
    async request<T>(_baseUrl: string, request: AepRequest): Promise<AepResponse<T>> {
      const body = (
        typeof request.body === 'string' ? JSON.parse(request.body) : (request.body ?? {})
      ) as JsonObject;
      requests.push({ path: request.path, body });
      if (options.rejectClient && body.client !== undefined) {
        return problem(400, 'INVALID_REQUEST') as AepResponse<T>;
      }
      if (request.path === '/aep/v1/auth/password/login') {
        if (options.rejectCredentials) return problem(401, 'INVALID_CREDENTIALS') as AepResponse<T>;
        return ok({
          accessToken: 'access-token',
          refreshToken: 'refresh-token',
          modelAccessToken: 'model-token',
          tokenType: 'Bearer',
          expiresIn: 900,
          modelAccessExpiresIn: 300,
          sessionId: 'session-1',
          passwordChangeRequired: false,
        }) as AepResponse<T>;
      }
      if (request.path === '/aep/v1/user/heartbeat') {
        if (options.heartbeatStatus)
          return problem(options.heartbeatStatus, 'INTERNAL_ERROR') as AepResponse<T>;
        return ok(heartbeat()) as AepResponse<T>;
      }
      return problem(404, 'NOT_FOUND') as AepResponse<T>;
    },
  };
  return { requests, transport, options };
}

function ok(data: unknown): AepResponse<unknown> {
  return { status: 200, headers: new Headers(), data };
}

function problem(status: number, code: string): AepResponse<unknown> {
  return {
    status,
    headers: new Headers(),
    data: {
      type: `https://aep.example/problems/${code.toLowerCase()}`,
      title: 'Problem',
      status,
      code,
      detail: 'Fixture problem.',
    },
  };
}

function heartbeat(): HeartbeatResponse {
  return {
    serverTime: '2026-09-30T00:00:00Z',
    controlEvents: { pending: false, watermark: '0' },
    nextHeartbeatAfterSeconds: 30,
  };
}
