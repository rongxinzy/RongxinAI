import { defineTool, type ToolRegistration } from '@earendil-works/pi-durable';
import { getOrThrow } from '@earendil-works/pi-durable/env';
import { Type } from 'typebox';

/** Read-only search calls run through the same environment and authorization hooks as all tools. */
export function createDurableSearchTools(): ToolRegistration[] {
  const ls = defineTool({
    name: 'ls',
    description: 'List up to 500 entries in a directory.',
    replay: 'safe',
    parameters: Type.Object({ path: Type.Optional(Type.String()) }),
    execute: async (args, api, context) => {
      if (!api.env) throw new Error('Execution environment is unavailable.');
      const reader = getOrThrow(await api.env.openDirReader(args.path ?? '.', context));
      try {
        const page = getOrThrow(await reader.next(500, context));
        return {
          output: [
            {
              type: 'text',
              text:
                page.entries
                  .map(entry => `${entry.name}${entry.kind === 'directory' ? '/' : ''}`)
                  .join('\n') + (page.done ? '' : '\n[Listing truncated after 500 entries.]'),
            },
          ],
        };
      } finally {
        await reader.close(context);
      }
    },
  });
  const find = defineTool({
    name: 'find',
    description: 'Find workspace files using a glob pattern and ripgrep.',
    replay: 'safe',
    parameters: Type.Object({ pattern: Type.String(), path: Type.Optional(Type.String()) }),
    execute: async (args, api, context) => {
      if (!api.env) throw new Error('Execution environment is unavailable.');
      const result = getOrThrow(
        await api.env.exec(
          ['rg', '--files', '--glob', args.pattern, '--', args.path ?? '.'],
          { timeout: 15_000, onOutput: chunk => api.output(chunk) },
          context,
        ),
      );
      return { isError: result.exitCode > 1 };
    },
  });
  const grep = defineTool({
    name: 'grep',
    description: 'Search text with ripgrep; returns matching file names and line numbers.',
    replay: 'safe',
    parameters: Type.Object({
      pattern: Type.String(),
      path: Type.Optional(Type.String()),
      glob: Type.Optional(Type.String()),
    }),
    execute: async (args, api, context) => {
      if (!api.env) throw new Error('Execution environment is unavailable.');
      const result = getOrThrow(
        await api.env.exec(
          [
            'rg',
            '--line-number',
            '--max-count',
            '100',
            ...(args.glob ? ['--glob', args.glob] : []),
            '--',
            args.pattern,
            args.path ?? '.',
          ],
          { timeout: 15_000, onOutput: chunk => api.output(chunk) },
          context,
        ),
      );
      return { isError: result.exitCode > 1 };
    },
  });
  return [ls, find, grep];
}
