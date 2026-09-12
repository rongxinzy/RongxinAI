import { describe, expect, test } from 'vitest';
import { FakeExtensionApi } from './solPiTestFixtures';

describe('FakeExtensionApi.emitContext fidelity with ExtensionRunner.emitContext', () => {
  test('clones the incoming messages so handler mutations never reach the caller', async () => {
    const api = new FakeExtensionApi();
    api.on('context', async event => {
      // Mutate both the array and a message object in place.
      event.messages.push({ role: 'toolResult', content: [] });
      (event.messages[0] as { role: string }).role = 'mutated';
      return undefined;
    });

    const original = [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }];
    const projected = await api.emitContext(original, undefined);

    expect(original).toEqual([{ role: 'user', content: [{ type: 'text', text: 'hi' }] }]);
    expect(original).toHaveLength(1);
    // The returned chain is the mutated clone, not the caller's array.
    expect(projected).toHaveLength(2);
    expect((projected[0] as { role: string }).role).toBe('mutated');
    expect(projected).not.toBe(original);
  });

  test('repeated emissions start from the untouched original every time', async () => {
    const api = new FakeExtensionApi();
    api.on('context', async event => {
      (event.messages[0] as { content: unknown[] }).content.push('mutated');
      return undefined;
    });
    const original = [{ role: 'user', content: [] }];
    await api.emitContext(original, undefined);
    await api.emitContext(original, undefined);
    expect(original).toEqual([{ role: 'user', content: [] }]);
    expect(api.contextHandlerErrors).toEqual([]);
  });

  test('a throwing handler is recorded and does not break the handler chain', async () => {
    const api = new FakeExtensionApi();
    const boom = new Error('context handler exploded');
    api.on('context', async () => {
      throw boom;
    });
    const secondRuns: number[] = [];
    api.on('context', async event => {
      secondRuns.push(event.messages.length);
      return { messages: [...event.messages, { role: 'assistant' }] };
    });

    const result = await api.emitContext([{ role: 'user' }], undefined);

    expect(secondRuns).toEqual([1]);
    expect(api.contextHandlerErrors).toEqual([boom]);
    expect(result).toEqual([{ role: 'user' }, { role: 'assistant' }]);
  });

  test('a handler failure after a successful projection keeps the projected chain', async () => {
    const api = new FakeExtensionApi();
    api.on('context', async () => ({ messages: [{ role: 'user', replaced: true }] }));
    api.on('context', async () => {
      throw new Error('second handler failed');
    });

    const result = await api.emitContext([{ role: 'user' }], undefined);
    expect(result).toEqual([{ role: 'user', replaced: true }]);
    expect(api.contextHandlerErrors).toHaveLength(1);
  });

  test('preserves the chained projection semantics', async () => {
    const api = new FakeExtensionApi();
    api.on('context', async event => ({ messages: [...event.messages, { step: 1 }] }));
    // A void return keeps the current chain untouched.
    api.on('context', async () => undefined);
    api.on('context', async event => ({ messages: [...event.messages, { step: 2 }] }));

    const result = await api.emitContext([{ role: 'user' }], undefined);
    expect(result).toEqual([{ role: 'user' }, { step: 1 }, { step: 2 }]);
    expect(api.contextHandlerErrors).toEqual([]);
  });

  test('with no handlers the result is a clone, never the caller array', async () => {
    const api = new FakeExtensionApi();
    const original = [{ role: 'user' }];
    const result = await api.emitContext(original, undefined);
    expect(result).toEqual(original);
    expect(result).not.toBe(original);
  });
});
