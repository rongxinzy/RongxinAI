import { execFile } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';

import {
  CoworkSessionMode,
  type CoworkSessionMode as CoworkSessionModeValue,
} from '../../../shared/cowork/constants';
import { PiExtensionEventType, type PiExtensionFactory } from './piExtensionTypes';

const RtkEnvironment = {
  DatabasePath: ':memory:',
  IgnoreCustomToml: '1',
  TelemetryDisabled: '1',
} as const;

const READ_ONLY_COMMANDS = new Set([
  'cat',
  'df',
  'du',
  'grep',
  'head',
  'ls',
  'ps',
  'rg',
  'tail',
  'tree',
  'wc',
]);

const READ_ONLY_GIT_SUBCOMMANDS = new Set([
  'blame',
  'cat-file',
  'describe',
  'diff',
  'grep',
  'log',
  'ls-files',
  'ls-tree',
  'rev-parse',
  'shortlog',
  'show',
  'status',
]);

const DIRECT_DEVELOPMENT_COMMANDS = new Set([
  'eslint',
  'golangci-lint',
  'jest',
  'pytest',
  'ruff',
  'tsc',
  'vitest',
]);

const SAFE_PACKAGE_SCRIPT_PATTERN = /^(?:build|check|lint|test|typecheck)(?::[\w.-]+)?$/;

const UNSAFE_SHELL_SYNTAX_PATTERN = /[\n\r|;&><`$()]/;

interface RewriteExecutionOptions {
  cwd: string;
  env: NodeJS.ProcessEnv;
  timeout: number;
  windowsHide: boolean;
  maxBuffer: number;
}

export type RtkRewriteExecutor = (
  executablePath: string,
  args: string[],
  options: RewriteExecutionOptions,
) => Promise<{ stdout: string }>;

export interface PiRtkCommandRewriteOptions {
  sessionMode: CoworkSessionModeValue;
  cwd: string;
  executablePath: string | null;
  teeDirectory: string;
  execute?: RtkRewriteExecutor;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function toShellPath(filePath: string): string {
  return process.platform === 'win32' ? filePath.replaceAll('\\', '/') : filePath;
}

function defaultExecute(
  executablePath: string,
  args: string[],
  options: RewriteExecutionOptions,
): Promise<{ stdout: string }> {
  return new Promise((resolve, reject) => {
    execFile(executablePath, args, options, (error, stdout) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ stdout: String(stdout) });
    });
  });
}

export function isRtkRewriteEligibleCommand(command: string): boolean {
  const trimmed = command.trim();
  if (!trimmed || UNSAFE_SHELL_SYNTAX_PATTERN.test(trimmed)) return false;

  const tokens = trimmed.split(/\s+/);
  const commandName = tokens[0]?.toLowerCase();
  if (!commandName) return false;
  if (commandName === 'git') {
    const subcommand = tokens[1]?.toLowerCase();
    return Boolean(subcommand && READ_ONLY_GIT_SUBCOMMANDS.has(subcommand));
  }
  if (['bun', 'npm', 'pnpm', 'yarn'].includes(commandName)) {
    const subcommand = tokens[1]?.toLowerCase();
    if (subcommand === 'test' || subcommand === 'build') return true;
    return subcommand === 'run' && SAFE_PACKAGE_SCRIPT_PATTERN.test(tokens[2] ?? '');
  }
  if (commandName === 'bunx' || commandName === 'npx') {
    return DIRECT_DEVELOPMENT_COMMANDS.has(tokens[1]?.toLowerCase() ?? '');
  }
  if (commandName === 'cargo') {
    return ['build', 'check', 'clippy', 'test'].includes(tokens[1]?.toLowerCase() ?? '');
  }
  if (commandName === 'go') return tokens[1]?.toLowerCase() === 'test';
  if (commandName === 'deno') {
    return ['check', 'lint', 'test'].includes(tokens[1]?.toLowerCase() ?? '');
  }
  if (DIRECT_DEVELOPMENT_COMMANDS.has(commandName)) return true;
  if (commandName === 'tail' && tokens.some(token => token === '-f' || token === '--follow')) {
    return false;
  }
  return READ_ONLY_COMMANDS.has(commandName);
}

function buildOptimizedCommand(
  rewrittenCommand: string,
  executablePath: string,
  teeDirectory: string,
): string | null {
  const trimmed = rewrittenCommand.trim();
  if (!/^rtk\s+/.test(trimmed)) return null;
  const rtkArguments = trimmed.replace(/^rtk\s+/, '');
  return [
    'env',
    `RTK_TELEMETRY_DISABLED=${RtkEnvironment.TelemetryDisabled}`,
    `RTK_NO_TOML=${RtkEnvironment.IgnoreCustomToml}`,
    `RTK_DB_PATH=${shellQuote(RtkEnvironment.DatabasePath)}`,
    `RTK_TEE_DIR=${shellQuote(toShellPath(teeDirectory))}`,
    shellQuote(toShellPath(executablePath)),
    rtkArguments,
  ].join(' ');
}

export function createPiRtkCommandRewriteExtension(
  options: PiRtkCommandRewriteOptions,
): PiExtensionFactory | null {
  if (options.sessionMode !== CoworkSessionMode.Work) return null;
  if (process.env.ZHIYUAN_RTK_DISABLED === '1') return null;

  const executablePath = options.executablePath;
  if (!executablePath || !existsSync(executablePath)) return null;

  const teeDirectory = options.teeDirectory;
  mkdirSync(teeDirectory, { recursive: true });
  const execute = options.execute ?? defaultExecute;
  let hasWarned = false;

  return extensionApi => {
    extensionApi.on(PiExtensionEventType.ToolCall, async event => {
      if (event.toolName !== 'bash' || !event.input || typeof event.input !== 'object') {
        return undefined;
      }
      const input = event.input as Record<string, unknown>;
      const command = input.command;
      if (typeof command !== 'string' || !isRtkRewriteEligibleCommand(command)) return undefined;

      try {
        const result = await execute(executablePath, ['rewrite', command], {
          cwd: options.cwd,
          env: {
            ...process.env,
            RTK_TELEMETRY_DISABLED: RtkEnvironment.TelemetryDisabled,
            RTK_NO_TOML: RtkEnvironment.IgnoreCustomToml,
            RTK_DB_PATH: RtkEnvironment.DatabasePath,
            RTK_TEE_DIR: teeDirectory,
          },
          timeout: 2_000,
          windowsHide: true,
          maxBuffer: 64 * 1024,
        });
        const optimizedCommand = buildOptimizedCommand(result.stdout, executablePath, teeDirectory);
        if (optimizedCommand) input.command = optimizedCommand;
      } catch (error) {
        if (!hasWarned) {
          console.warn(
            '[RtkCommandRewrite] command optimization failed; using the original command:',
            error,
          );
          hasWarned = true;
        }
      }
      return undefined;
    });
  };
}
