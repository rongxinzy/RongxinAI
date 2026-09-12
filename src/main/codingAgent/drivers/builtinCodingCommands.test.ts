import { expect, test } from 'vitest';

import {
  BuiltinCodingControlCommand,
  buildBuiltinCodingCommandList,
  parseBuiltinCodingControlCommand,
  parseBuiltinCodingPrompt,
  resolveBuiltinCodingTurnMode,
} from './builtinCodingCommands';

test('advertises the built-in prompt and control commands together', () => {
  expect(buildBuiltinCodingCommandList().map(command => command.name)).toEqual([
    'plan',
    'goal',
    BuiltinCodingControlCommand.Compact,
    BuiltinCodingControlCommand.Status,
  ]);
});

test('recognizes a bare control command and nothing that carries arguments', () => {
  expect(parseBuiltinCodingControlCommand('/compact')).toBe(BuiltinCodingControlCommand.Compact);
  expect(parseBuiltinCodingControlCommand('  /status  ')).toBe(BuiltinCodingControlCommand.Status);
  for (const prompt of [
    '/compact the login module',
    '/status please',
    '/plan migrate the auth flow',
    'run /compact',
    '/unknown',
  ]) {
    expect(parseBuiltinCodingControlCommand(prompt)).toBeNull();
  }
});

test('parses the goal command and keeps only the goal body', () => {
  expect(parseBuiltinCodingPrompt('/goal ship the migration')).toEqual({
    prompt: 'ship the migration',
    goalMode: true,
    planMode: false,
  });
  expect(parseBuiltinCodingPrompt('  /goal\nmulti-line\nbody  ')).toEqual({
    prompt: 'multi-line\nbody',
    goalMode: true,
    planMode: false,
  });
});

test('parses the plan command into a read-only planning turn', () => {
  expect(parseBuiltinCodingPrompt('/plan migrate the auth flow')).toEqual({
    prompt: 'migrate the auth flow',
    goalMode: false,
    planMode: true,
  });
});

test('leaves everything that is not a goal command untouched', () => {
  for (const prompt of ['/goal', '/plan', '/goals ship the migration', '/unknown do something']) {
    expect(parseBuiltinCodingPrompt(prompt)).toEqual({
      prompt,
      goalMode: false,
      planMode: false,
    });
  }
});

test('keeps prompts that merely mention a command', () => {
  for (const prompt of ['explain /goal usage', 'run the tests']) {
    expect(parseBuiltinCodingPrompt(prompt)).toEqual({
      prompt,
      goalMode: false,
      planMode: false,
    });
  }
});

test('lets the goal command override the read-only plan session mode', () => {
  expect(resolveBuiltinCodingTurnMode(parseBuiltinCodingPrompt('/goal ship it'), true)).toEqual({
    goalMode: true,
    planMode: false,
  });
  expect(resolveBuiltinCodingTurnMode(parseBuiltinCodingPrompt('/plan ship it'), false)).toEqual({
    goalMode: false,
    planMode: true,
  });
  expect(resolveBuiltinCodingTurnMode(parseBuiltinCodingPrompt('ship it'), true)).toEqual({
    goalMode: false,
    planMode: true,
  });
  expect(resolveBuiltinCodingTurnMode(parseBuiltinCodingPrompt('ship it'), false)).toEqual({
    goalMode: false,
    planMode: false,
  });
});
