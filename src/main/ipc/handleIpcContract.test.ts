import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { ipcMain } from 'electron';

import { z } from 'zod';

import { defineIpcContract } from '../../shared/ipc/contract';
import { handleIpcContract } from './handleIpcContract';

// tests/__mocks__/electron.ts registers ipcMain.handle as a no-op stub; capture
// the registrations so tests can invoke the wrapped handler directly.
type RegisteredHandler = (event: unknown, ...args: unknown[]) => unknown;
const registered = new Map<string, RegisteredHandler>();

beforeEach(() => {
  registered.clear();
  vi.spyOn(ipcMain, 'handle').mockImplementation((channel, handler) => {
    registered.set(channel, handler as RegisteredHandler);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const contract = defineIpcContract({
  add: {
    channel: 'test:contract:add',
    args: z.tuple([z.number(), z.number()]),
    result: z.number(),
  },
  greet: {
    channel: 'test:contract:greet',
    args: z.tuple([z.object({ name: z.string() })]),
    result: z.object({ message: z.string() }),
  },
  noArgs: {
    channel: 'test:contract:noArgs',
    args: z.tuple([]),
    result: z.boolean(),
  },
});

const event = { sender: { id: 1 } };

describe('handleIpcContract', () => {
  test('registers one ipcMain.handle per contract method', () => {
    handleIpcContract(contract, {
      add: (_event, a, b) => a + b,
      greet: (_event, { name }) => ({ message: `hello ${name}` }),
      noArgs: () => true,
    });
    expect([...registered.keys()].sort()).toEqual([
      'test:contract:add',
      'test:contract:greet',
      'test:contract:noArgs',
    ]);
  });

  test('valid args reach the impl parsed and typed', async () => {
    const add = vi.fn((_event: unknown, a: number, b: number) => a + b);
    handleIpcContract(contract, {
      add,
      greet: () => ({ message: '' }),
      noArgs: () => true,
    });

    await expect(registered.get('test:contract:add')!(event, 2, 3)).resolves.toBe(5);
    expect(add).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith(event, 2, 3);
  });

  test('impl receives the forwarded ipc event', async () => {
    const seen: unknown[] = [];
    handleIpcContract(contract, {
      add: (e) => {
        seen.push(e);
        return 0;
      },
      greet: () => ({ message: '' }),
      noArgs: () => true,
    });

    const senderEvent = { sender: { id: 42 } };
    await registered.get('test:contract:add')!(senderEvent, 1, 1);
    expect(seen).toEqual([senderEvent]);
  });

  test('invalid args reject naming the channel and impl is not called', async () => {
    const add = vi.fn(() => 0);
    handleIpcContract(contract, {
      add,
      greet: () => ({ message: '' }),
      noArgs: () => true,
    });

    const invocation = registered.get('test:contract:add')!(event, 2, 'three');
    await expect(invocation).rejects.toThrow(
      /test:contract:add rejected invalid arguments: .*expected number/s,
    );
    expect(add).not.toHaveBeenCalled();
  });

  test('rejection message summarizes every zod issue on one line', async () => {
    handleIpcContract(contract, {
      add: () => 0,
      greet: () => ({ message: '' }),
      noArgs: () => true,
    });

    // Tuple arity failure: path empty, message mentions item count.
    await expect(registered.get('test:contract:greet')!(event, 42)).rejects.toThrow(
      'IPC test:contract:greet rejected invalid arguments: 0: Invalid input: expected object, received number',
    );
  });

  test('missing args reject and impl is not called', async () => {
    const add = vi.fn(() => 0);
    handleIpcContract(contract, {
      add,
      greet: () => ({ message: '' }),
      noArgs: () => true,
    });

    await expect(registered.get('test:contract:add')!(event)).rejects.toThrow(
      'IPC test:contract:add rejected invalid arguments: : Too small: expected array to have >=2 items',
    );
    expect(add).not.toHaveBeenCalled();
  });

  test('impl throw propagates as a rejection', async () => {
    handleIpcContract(contract, {
      add: () => {
        throw new Error('boom');
      },
      greet: () => ({ message: '' }),
      noArgs: () => true,
    });

    await expect(registered.get('test:contract:add')!(event, 1, 1)).rejects.toThrow('boom');
  });

  test('impl return value passes through untouched (no result validation in production)', async () => {
    const extra = { success: true, undocumented: 'kept' };
    handleIpcContract(
      defineIpcContract({
        probe: {
          channel: 'test:contract:probe',
          args: z.tuple([]),
          result: z.object({ success: z.boolean() }),
        },
      }),
      { probe: () => extra },
    );

    await expect(registered.get('test:contract:probe')!(event)).resolves.toBe(extra);
  });
});
