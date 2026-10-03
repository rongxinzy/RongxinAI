import { expect, test } from 'vitest';

import {
  buildCoworkSlashCommands,
  coworkSlashCommandArgument,
  coworkSlashCommandPrompt,
  coworkSlashCommandQuery,
  coworkSlashSelectionPrompt,
  filterCoworkSlashCommands,
  filterCoworkSlashOptions,
  parseCoworkSlashSubmission,
  type CoworkSlashCommandItem,
} from './coworkSlashCommands';

const commands: CoworkSlashCommandItem[] = [
  { name: 'skill', description: 'Activate a skill for this message', hint: 'skill id' },
  { name: 'compact', description: 'Compact the current session context' },
];

test('opens command discovery only for a leading slash token', () => {
  expect(coworkSlashCommandQuery('/')).toBe('');
  expect(coworkSlashCommandQuery('/com')).toBe('com');
  expect(coworkSlashCommandQuery('/skill pdf')).toBeNull();
  expect(coworkSlashCommandQuery('please /compact')).toBeNull();
});

test('detects a single-token argument after a command', () => {
  expect(coworkSlashCommandArgument('/skill ')).toEqual({ name: 'skill', query: '' });
  expect(coworkSlashCommandArgument('/skill pd')).toEqual({ name: 'skill', query: 'pd' });
  expect(coworkSlashCommandArgument('/skill pdf fill the form')).toBeNull();
  expect(coworkSlashCommandArgument('/')).toBeNull();
  expect(coworkSlashCommandArgument('use /skill pd')).toBeNull();
});

test('filters commands by name or description and prioritizes name matches', () => {
  expect(filterCoworkSlashCommands(commands, '')).toEqual(commands);
  expect(filterCoworkSlashCommands(commands, 'skill')).toEqual([commands[0]]);
  expect(filterCoworkSlashCommands(commands, 'context')).toEqual([commands[1]]);
  expect(filterCoworkSlashCommands(commands, 'missing')).toEqual([]);
});

test('filters selection entries with an exact match first', () => {
  const options = [
    { value: 'pdf', label: 'PDF toolkit' },
    { value: 'pdf-forms', label: 'PDF forms' },
    { value: 'seedream', label: 'Image generation' },
  ];

  expect(filterCoworkSlashOptions(options, '')).toEqual(options);
  expect(filterCoworkSlashOptions(options, 'pdf')).toEqual([options[0], options[1]]);
  expect(filterCoworkSlashOptions(options, 'forms')).toEqual([options[1]]);
  expect(filterCoworkSlashOptions(options, 'missing')).toEqual([]);
});

test('inserts a trailing space only for commands that take an argument', () => {
  expect(coworkSlashCommandPrompt(commands[0])).toBe('/skill ');
  expect(coworkSlashCommandPrompt(commands[1])).toBe('/compact');
  expect(coworkSlashSelectionPrompt('skill', 'pdf')).toBe('/skill pdf ');
});

test('builds the command list from availability', () => {
  const text = {
    skillDescription: 'skill desc',
    skillHint: 'skill id',
    compactDescription: 'compact desc',
  };
  expect(buildCoworkSlashCommands({ skills: true, compact: true }, text)).toEqual([
    { name: 'skill', description: 'skill desc', hint: 'skill id' },
    { name: 'compact', description: 'compact desc' },
  ]);
  expect(buildCoworkSlashCommands({ skills: false, compact: true }, text)).toEqual([
    { name: 'compact', description: 'compact desc' },
  ]);
  expect(buildCoworkSlashCommands({ skills: true, compact: false }, text)).toEqual([
    { name: 'skill', description: 'skill desc', hint: 'skill id' },
  ]);
  expect(buildCoworkSlashCommands({ skills: false, compact: false }, text)).toEqual([]);
});

const context = { skillIds: ['pdf', 'seedream'], compactAvailable: true };

test('parses /skill with a body into an activation plus prompt', () => {
  expect(parseCoworkSlashSubmission('/skill pdf fill the form', context)).toEqual({
    kind: 'skill',
    skillId: 'pdf',
    body: 'fill the form',
  });
});

test('parses a bare /skill id into an activation without a prompt', () => {
  expect(parseCoworkSlashSubmission('/skill pdf', context)).toEqual({
    kind: 'skill',
    skillId: 'pdf',
    body: '',
  });
  expect(parseCoworkSlashSubmission('  /skill pdf  ', context)).toEqual({
    kind: 'skill',
    skillId: 'pdf',
    body: '',
  });
});

test('parses a bare /compact into the control command', () => {
  expect(parseCoworkSlashSubmission('/compact', context)).toEqual({ kind: 'compact' });
});

test('passes /compact with trailing text through to the model', () => {
  expect(parseCoworkSlashSubmission('/compact the login module', context)).toEqual({
    kind: 'prompt',
    prompt: '/compact the login module',
  });
});

test('passes /compact through when no session can be compacted', () => {
  expect(
    parseCoworkSlashSubmission('/compact', { skillIds: ['pdf'], compactAvailable: false }),
  ).toEqual({ kind: 'prompt', prompt: '/compact' });
});

test('passes an unknown command through unchanged', () => {
  expect(parseCoworkSlashSubmission('/review the diff', context)).toEqual({
    kind: 'prompt',
    prompt: '/review the diff',
  });
});

test('passes an unknown skill id through unchanged', () => {
  expect(parseCoworkSlashSubmission('/skill missing do things', context)).toEqual({
    kind: 'prompt',
    prompt: '/skill missing do things',
  });
  expect(parseCoworkSlashSubmission('/skill missing', context)).toEqual({
    kind: 'prompt',
    prompt: '/skill missing',
  });
});

test('passes a bare /skill through unchanged', () => {
  expect(parseCoworkSlashSubmission('/skill', context)).toEqual({
    kind: 'prompt',
    prompt: '/skill',
  });
});
