import { expect, test } from 'vitest';

import type { CodingAgentAvailableCommand } from '../../../shared/codingAgent';
import {
  filterCommandOptions,
  filterSlashCommands,
  slashCommandArgument,
  slashCommandPrompt,
  slashCommandQuery,
  slashCommandSelectionPrompt,
} from './codingSlashCommands';

const commands: CodingAgentAvailableCommand[] = [
  { name: 'mcp', description: 'List configured MCP tools.' },
  { name: 'skills', description: 'List available skills.' },
  { name: 'review', description: 'Review changes.', input: { hint: 'optional instructions' } },
];

test('opens command discovery only for a leading slash token', () => {
  expect(slashCommandQuery('/')).toBe('');
  expect(slashCommandQuery('/ski')).toBe('ski');
  expect(slashCommandQuery('/review changed files')).toBeNull();
  expect(slashCommandQuery('please /review')).toBeNull();
});

test('filters commands by name or description and prioritizes command-name matches', () => {
  expect(filterSlashCommands(commands, 'skill')).toEqual([commands[1]]);
  expect(filterSlashCommands(commands, 'configured')).toEqual([commands[0]]);
  expect(filterSlashCommands(commands, '')).toEqual(commands);
  expect(
    filterSlashCommands(
      [
        { name: 'plan', description: 'Turn plan mode on.' },
        ...commands,
      ],
      'm',
    )[0],
  ).toEqual(commands[0]);
});

test('inserts an argument separator only when the ACP command declares input', () => {
  expect(slashCommandPrompt(commands[0])).toBe('/mcp');
  expect(slashCommandPrompt(commands[2])).toBe('/review ');
});

test('detects a single-token argument after a command', () => {
  expect(slashCommandArgument('/skill ')).toEqual({ name: 'skill', query: '' });
  expect(slashCommandArgument('/skill pd')).toEqual({ name: 'skill', query: 'pd' });
  expect(slashCommandArgument('/skill pdf fill the form')).toBeNull();
  expect(slashCommandArgument('/')).toBeNull();
  expect(slashCommandArgument('use /skill pd')).toBeNull();
});

test('filters selection entries with an exact match first', () => {
  const options = [
    { value: 'pdf', label: 'PDF toolkit' },
    { value: 'pdf-forms', label: 'PDF forms' },
    { value: 'off', label: 'No skill' },
  ];

  expect(filterCommandOptions(options, '')).toEqual(options);
  expect(filterCommandOptions(options, 'pdf')).toEqual([options[0], options[1]]);
  expect(filterCommandOptions(options, 'forms')).toEqual([options[1]]);
  expect(filterCommandOptions(options, 'missing')).toEqual([]);
});

test('inserts the selected entry after the command name', () => {
  expect(slashCommandSelectionPrompt('skill', 'pdf')).toBe('/skill pdf ');
});
