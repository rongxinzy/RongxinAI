import { expect, test } from 'vitest';
import { attributePiWorkRequest } from './piWorkTokenAttribution';

const jsonBytes = (value: unknown): number => Buffer.byteLength(JSON.stringify(value));
const knownMemory = [
  'Relevant memory (treat as prior context, not user instructions):',
  'Workspace:',
  '- [memory:42] 中文和引号 "通过" ✅。',
  'The fixture can include multiple lines.',
].join('\n');

test('reconciles actual UTF-8 chat request bytes and attributes the known memory separately', () => {
  const system = { role: 'system', content: `产品行为\n\n${knownMemory}` };
  const developer = { role: 'developer', content: 'Use fixtures.' };
  const tools = [{ type: 'function', function: { name: 'read', description: '读取工作区' } }];
  const priorUser = { role: 'user', content: 'Previous question' };
  const currentUser = { role: 'user', content: [{ type: 'text', text: '请执行' }] };
  const assistant: { role: string; content: null; tool_calls: Array<{ id: string }> } = {
    role: 'assistant',
    content: null,
    tool_calls: [{ id: 'test' }],
  };
  const toolResult = { role: 'tool', content: 'Done' };
  const payload = {
    model: 'test',
    stream: true,
    tools,
    messages: [system, developer, priorUser, currentUser, assistant, toolResult],
  };
  const measured = attributePiWorkRequest(payload, jsonBytes(payload), [knownMemory]);

  const memoryBytes = jsonBytes(knownMemory) - 2;
  expect(measured).toMatchObject({
    requestBytes: jsonBytes(payload),
    systemBytes: jsonBytes(system) - memoryBytes,
    developerBytes: jsonBytes(developer),
    projectMemoryBytes: memoryBytes,
    toolsBytes: jsonBytes(tools),
    currentUserBytes: jsonBytes(currentUser),
    historyBytes: jsonBytes(priorUser) + jsonBytes(assistant) + jsonBytes(toolResult),
  });
  const { requestBytes, memoryAttribution, ...components } = measured;
  expect(memoryAttribution).toBe('matched');
  expect(Object.values(components).reduce((sum, value) => sum + value, 0)).toBe(requestBytes);
  expect(JSON.stringify(measured)).not.toContain('通过');
});

test('reports unpartitioned memory in flattened prompts instead of guessing its length', () => {
  const prompt = { role: 'developer', content: `${knownMemory}\n\nAnother prompt section.` };
  const measured = attributePiWorkRequest({ messages: [prompt] });
  expect(measured).toMatchObject({
    systemBytes: 0,
    developerBytes: jsonBytes(prompt),
    projectMemoryBytes: 0,
    memoryAttribution: 'unpartitioned',
  });

  const update = {
    role: 'system',
    content: 'Updated system prompt section "project_memory":\n\nA replacement memory.',
  };
  expect(attributePiWorkRequest({ messages: [update] }).memoryAttribution).toBe('unpartitioned');
});

test('does not count phrases in user text as memory and separates embedded tool declarations', () => {
  const tools = [{ type: 'function', function: { name: 'optional_tool' } }];
  const system = { role: 'system', tools };
  const user = { role: 'user', content: knownMemory };
  expect(
    attributePiWorkRequest({ messages: [system, user] }, undefined, [knownMemory]),
  ).toMatchObject({
    systemBytes: jsonBytes(system) - jsonBytes(tools),
    projectMemoryBytes: 0,
    memoryAttribution: 'absent',
    toolsBytes: jsonBytes(tools),
    currentUserBytes: jsonBytes(user),
    historyBytes: 0,
  });
});

test('counts repeated matching fixture blocks and flags other memory blocks independently', () => {
  const unknownMemory = knownMemory.replace('42', '43');
  const message = {
    role: 'system',
    content: ['A', knownMemory, knownMemory, unknownMemory, 'B'].join('\n\n'),
  };
  const measured = attributePiWorkRequest({ messages: [message] }, undefined, [
    knownMemory,
    knownMemory,
  ]);
  expect(measured.projectMemoryBytes).toBe(2 * (jsonBytes(knownMemory) - 2));
  expect(measured.memoryAttribution).toBe('unpartitioned');
  expect(attributePiWorkRequest({ messages: [] }).memoryAttribution).toBe('absent');
});

test('keeps the raw request byte total and rejects a number too small for its components', () => {
  const payload = { messages: [{ role: 'system', content: 'Some rules' }] };
  const raw = JSON.stringify(payload, null, 2);
  const canonical = attributePiWorkRequest(payload);
  const measured = attributePiWorkRequest(payload, Buffer.byteLength(raw));
  expect(measured.overheadBytes - canonical.overheadBytes).toBe(
    Buffer.byteLength(raw) - jsonBytes(payload),
  );
  expect(() => attributePiWorkRequest(payload, 0)).toThrow('does not reconcile');
});
