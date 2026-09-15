import { expect, test } from 'vitest';

import {
  BuiltinCodingCommand,
  BuiltinCodingControlCommand,
  BuiltinCodingSelectionOff,
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
    BuiltinCodingControlCommand.Mcp,
  ]);
});

test('advertises installed skills, experts and MCP servers', () => {
  const choices = {
    skills: [{ id: 'pdf', name: 'PDF toolkit', description: 'Fill PDF forms.' }],
    experts: [{ id: 'expert-1', name: 'Staff engineer', description: 'Reviews designs.' }],
    mcpServers: [{ id: 'github', name: 'github', description: 'GitHub tools.' }],
  };

  const names = buildBuiltinCodingCommandList(choices).map(command => command.name);
  expect(names).toEqual([
    'plan',
    'goal',
    BuiltinCodingCommand.Skill,
    BuiltinCodingCommand.Expert,
    BuiltinCodingControlCommand.Compact,
    BuiltinCodingControlCommand.Status,
    BuiltinCodingControlCommand.Mcp,
  ]);
  const skill = buildBuiltinCodingCommandList(choices).find(
    command => command.name === BuiltinCodingCommand.Skill,
  );
  expect(skill?.input?.options?.map(option => option.value)).toEqual([
    'pdf',
    BuiltinCodingSelectionOff,
  ]);
  expect(skill?.input?.options?.[0]).toMatchObject({
    value: 'pdf',
    label: 'PDF toolkit',
    description: 'Fill PDF forms.',
  });
  const mcp = buildBuiltinCodingCommandList(choices).find(
    command => command.name === BuiltinCodingControlCommand.Mcp,
  );
  // A bare command reports on every server, so the menu offers the real ones.
  expect(mcp?.input?.options).toEqual([
    { value: 'github', label: 'github', description: 'GitHub tools.' },
  ]);
  expect(mcp?.input?.hint).toEqual(expect.any(String));
});

test('advertises the mcp report even with no server configured', () => {
  const commands = buildBuiltinCodingCommandList({ skills: [], experts: [], mcpServers: [] });
  const mcp = commands.find(command => command.name === BuiltinCodingControlCommand.Mcp);

  // The report itself is the answer to "why is nothing connected", so the
  // command stays in the menu and simply offers no server candidates.
  expect(mcp?.input?.hint).toEqual(expect.any(String));
  expect(mcp?.input?.options ?? []).toEqual([]);
});

test('parses skill and expert selections and keeps only the turn body', () => {
  const choices = {
    skills: [{ id: 'pdf', name: 'PDF toolkit', description: '' }],
    experts: [{ id: 'expert-1', name: 'Staff engineer', description: '' }],
    mcpServers: [],
  };

  expect(parseBuiltinCodingPrompt('/skill pdf fill the form', choices)).toEqual({
    prompt: 'fill the form',
    goalMode: false,
    planMode: false,
    selection: { kind: 'skill', id: 'pdf' },
  });
  expect(parseBuiltinCodingPrompt('/expert expert-1 review the migration', choices)).toEqual({
    prompt: 'review the migration',
    goalMode: false,
    planMode: false,
    selection: { kind: 'expert', id: 'expert-1' },
  });
  expect(parseBuiltinCodingPrompt('/skill off back to plain turns', choices)).toEqual({
    prompt: 'back to plain turns',
    goalMode: false,
    planMode: false,
    selection: { kind: 'skill', id: null },
  });
});

test('lets an installed entry own the reserved clearing argument', () => {
  const choices = {
    skills: [
      { id: BuiltinCodingSelectionOff, name: 'Off switch', description: 'Turns things off.' },
    ],
    experts: [],
    mcpServers: [],
  };

  const skill = buildBuiltinCodingCommandList(choices).find(
    command => command.name === BuiltinCodingCommand.Skill,
  );
  // The installed entry replaces the clearing entry instead of duplicating it.
  expect(skill?.input?.options?.map(option => option.value)).toEqual([BuiltinCodingSelectionOff]);
  expect(skill?.input?.options?.[0]).toMatchObject({ label: 'Off switch' });
  expect(parseBuiltinCodingPrompt(`/skill ${BuiltinCodingSelectionOff} run it`, choices)).toEqual({
    prompt: 'run it',
    goalMode: false,
    planMode: false,
    selection: { kind: 'skill', id: BuiltinCodingSelectionOff },
  });
});

test('passes unknown, bare and non-leading selections through untouched', () => {
  const choices = {
    skills: [{ id: 'pdf', name: 'PDF toolkit', description: '' }],
    experts: [],
    mcpServers: [],
  };

  for (const prompt of [
    '/skill pdf',
    '/skill missing fill the form',
    '/expert missing review it',
    'use /skill pdf please',
    '/skills pdf fill the form',
  ]) {
    expect(parseBuiltinCodingPrompt(prompt, choices)).toEqual({
      prompt,
      goalMode: false,
      planMode: false,
    });
  }
});

test('recognizes a bare control command and nothing that carries arguments', () => {
  expect(parseBuiltinCodingControlCommand('/compact')).toEqual({
    command: BuiltinCodingControlCommand.Compact,
    target: null,
  });
  expect(parseBuiltinCodingControlCommand('  /status  ')).toEqual({
    command: BuiltinCodingControlCommand.Status,
    target: null,
  });
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

test('scopes the mcp report to one server and nothing longer', () => {
  expect(parseBuiltinCodingControlCommand('/mcp')).toEqual({
    command: BuiltinCodingControlCommand.Mcp,
    target: null,
  });
  expect(parseBuiltinCodingControlCommand('  /mcp github  ')).toEqual({
    command: BuiltinCodingControlCommand.Mcp,
    target: 'github',
  });
  for (const prompt of ['/mcp github list the open issues', '/mcpx github']) {
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
