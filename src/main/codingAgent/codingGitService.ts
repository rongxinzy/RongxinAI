import { spawn } from 'child_process';
import { readFile, stat } from 'fs/promises';
import path from 'path';

import {
  CodingGitDiffScope,
  CodingGitFileStatus,
  type CodingGitDiffInput,
  type CodingGitFileChange,
  type CodingGitFileStatus as CodingGitFileStatusType,
  type CodingGitStatus,
} from '../../shared/codingAgent';

const GIT_COMMAND_TIMEOUT_MS = 15_000;
const MAX_GIT_OUTPUT_BYTES = 2 * 1024 * 1024;
const MAX_DIFF_OUTPUT_BYTES = 512 * 1024;
const MAX_PATHS_PER_ACTION = 500;
const MAX_UNTRACKED_COUNT_BYTES = 1024 * 1024;

interface GitCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface ParsedGitStatus {
  branch: string | null;
  head: string | null;
  detached: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
  files: CodingGitFileChange[];
}

interface GitNumStat {
  additions: number | null;
  deletions: number | null;
}

const runGit = async (
  cwd: string,
  args: string[],
  options: { acceptedExitCodes?: number[]; maxOutputBytes?: number } = {},
): Promise<GitCommandResult> => {
  const acceptedExitCodes = options.acceptedExitCodes ?? [0];
  const maxOutputBytes = options.maxOutputBytes ?? MAX_GIT_OUTPUT_BYTES;
  return await new Promise<GitCommandResult>((resolve, reject) => {
    const child = spawn('git', args, {
      cwd,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        LC_ALL: 'C',
        LANG: 'C',
      },
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback();
    };
    const append = (current: string, chunk: Buffer | string): string => {
      const next = `${current}${chunk.toString()}`;
      if (Buffer.byteLength(next, 'utf8') > maxOutputBytes) {
        child.kill();
        finish(() => reject(new Error('Git output exceeded the safe display limit.')));
      }
      return next;
    };
    child.stdout.on('data', chunk => {
      if (!settled) stdout = append(stdout, chunk);
    });
    child.stderr.on('data', chunk => {
      if (!settled) stderr = append(stderr, chunk);
    });
    child.once('error', error => finish(() => reject(error)));
    child.once('exit', code => {
      const exitCode = code ?? -1;
      finish(() => {
        if (acceptedExitCodes.includes(exitCode)) {
          resolve({ stdout, stderr, exitCode });
        } else {
          reject(new Error(stderr.trim() || `git ${args[0]} failed with exit code ${exitCode}.`));
        }
      });
    });
    const timeout = setTimeout(() => {
      child.kill();
      finish(() => reject(new Error(`git ${args[0]} timed out.`)));
    }, GIT_COMMAND_TIMEOUT_MS);
  });
};

const statusFromCode = (code: string): CodingGitFileStatusType | null => {
  switch (code) {
    case 'A':
      return CodingGitFileStatus.Added;
    case 'M':
      return CodingGitFileStatus.Modified;
    case 'D':
      return CodingGitFileStatus.Deleted;
    case 'R':
      return CodingGitFileStatus.Renamed;
    case 'C':
      return CodingGitFileStatus.Copied;
    case 'U':
      return CodingGitFileStatus.Conflicted;
    case 'T':
      return CodingGitFileStatus.TypeChanged;
    case '?':
      return CodingGitFileStatus.Untracked;
    default:
      return null;
  }
};

const parsePorcelainStatus = (output: string): ParsedGitStatus => {
  const records = output.split('\0').filter(Boolean);
  const files: CodingGitFileChange[] = [];
  let branch: string | null = null;
  let head: string | null = null;
  let detached = false;
  let upstream: string | null = null;
  let ahead = 0;
  let behind = 0;

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record.startsWith('# branch.oid ')) {
      const value = record.slice('# branch.oid '.length);
      head = value === '(initial)' ? null : value;
      continue;
    }
    if (record.startsWith('# branch.head ')) {
      const value = record.slice('# branch.head '.length);
      detached = value === '(detached)';
      branch = detached ? null : value;
      continue;
    }
    if (record.startsWith('# branch.upstream ')) {
      upstream = record.slice('# branch.upstream '.length);
      continue;
    }
    if (record.startsWith('# branch.ab ')) {
      const match = /\+(\d+)\s+-(\d+)/.exec(record);
      if (match) {
        ahead = Number(match[1]);
        behind = Number(match[2]);
      }
      continue;
    }
    if (record.startsWith('? ')) {
      files.push({
        path: record.slice(2),
        indexStatus: null,
        worktreeStatus: CodingGitFileStatus.Untracked,
        additions: null,
        deletions: null,
      });
      continue;
    }
    if (record.startsWith('1 ')) {
      const fields = record.split(' ');
      const xy = fields[1] ?? '..';
      files.push({
        path: fields.slice(8).join(' '),
        indexStatus: statusFromCode(xy[0]),
        worktreeStatus: statusFromCode(xy[1]),
        additions: null,
        deletions: null,
      });
      continue;
    }
    if (record.startsWith('2 ')) {
      const fields = record.split(' ');
      const xy = fields[1] ?? '..';
      const originalPath = records[index + 1];
      index += 1;
      files.push({
        path: fields.slice(9).join(' '),
        originalPath,
        indexStatus: statusFromCode(xy[0]),
        worktreeStatus: statusFromCode(xy[1]),
        additions: null,
        deletions: null,
      });
      continue;
    }
    if (record.startsWith('u ')) {
      const fields = record.split(' ');
      files.push({
        path: fields.slice(10).join(' '),
        indexStatus: CodingGitFileStatus.Conflicted,
        worktreeStatus: CodingGitFileStatus.Conflicted,
        additions: null,
        deletions: null,
      });
    }
  }

  return { branch, head, detached, upstream, ahead, behind, files };
};

const parseNumStat = (output: string): Map<string, GitNumStat> => {
  const result = new Map<string, GitNumStat>();
  const records = output.split('\0');
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record) continue;
    const fields = record.split('\t');
    if (fields.length < 3) continue;
    let filePath = fields.slice(2).join('\t');
    if (!filePath) {
      index += 2;
      filePath = records[index] ?? '';
    }
    if (!filePath) continue;
    const additions = fields[0] === '-' ? null : Number(fields[0]);
    const deletions = fields[1] === '-' ? null : Number(fields[1]);
    const current = result.get(filePath);
    result.set(filePath, {
      additions:
        additions === null || current?.additions === null
          ? null
          : (current?.additions ?? 0) + additions,
      deletions:
        deletions === null || current?.deletions === null
          ? null
          : (current?.deletions ?? 0) + deletions,
    });
  }
  return result;
};

const mergeNumStats = (target: Map<string, GitNumStat>, source: Map<string, GitNumStat>) => {
  for (const [filePath, value] of source) {
    const current = target.get(filePath);
    target.set(filePath, {
      additions:
        value.additions === null || current?.additions === null
          ? null
          : (current?.additions ?? 0) + value.additions,
      deletions:
        value.deletions === null || current?.deletions === null
          ? null
          : (current?.deletions ?? 0) + value.deletions,
    });
  }
};

const requireRelativePaths = (paths: string[]): string[] => {
  const values = [...new Set(paths.map(value => value.trim()).filter(Boolean))];
  if (!values.length) throw new Error('Select at least one Git path.');
  if (values.length > MAX_PATHS_PER_ACTION) throw new Error('Too many Git paths were selected.');
  for (const value of values) {
    if (path.isAbsolute(value) || value.split(/[\\/]/).includes('..')) {
      throw new Error('Git paths must stay inside the selected repository.');
    }
  }
  return values;
};

const countUntrackedLines = async (
  repositoryRoot: string,
  filePath: string,
): Promise<number | null> => {
  const absolutePath = path.resolve(repositoryRoot, filePath);
  const relativePath = path.relative(repositoryRoot, absolutePath);
  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) return null;
  try {
    const fileStat = await stat(absolutePath);
    if (!fileStat.isFile() || fileStat.size > MAX_UNTRACKED_COUNT_BYTES) return null;
    const content = await readFile(absolutePath);
    if (content.includes(0)) return null;
    if (!content.length) return 0;
    let lines = 1;
    for (const byte of content) if (byte === 10) lines += 1;
    return content.at(-1) === 10 ? lines - 1 : lines;
  } catch {
    return null;
  }
};

export class CodingGitService {
  async getStatus(
    targetRoot: string,
    context: { isIsolated: boolean; isBusy: boolean },
  ): Promise<CodingGitStatus> {
    let repositoryRoot: string;
    try {
      repositoryRoot = (await runGit(targetRoot, ['rev-parse', '--show-toplevel'])).stdout.trim();
    } catch {
      return {
        isRepository: false,
        targetRoot,
        repositoryRoot: null,
        branch: null,
        head: null,
        detached: false,
        upstream: null,
        ahead: 0,
        behind: 0,
        additions: 0,
        deletions: 0,
        files: [],
        isIsolated: context.isIsolated,
        isBusy: context.isBusy,
        canMutate: false,
      };
    }

    const statusOutput = (await runGit(targetRoot, ['status', '--porcelain=v2', '--branch', '-z']))
      .stdout;
    const parsed = parsePorcelainStatus(statusOutput);
    const [stagedOutput, unstagedOutput] = await Promise.all([
      runGit(targetRoot, ['diff', '--cached', '--numstat', '-z']).then(result => result.stdout),
      runGit(targetRoot, ['diff', '--numstat', '-z']).then(result => result.stdout),
    ]);
    const numStats = parseNumStat(stagedOutput);
    mergeNumStats(numStats, parseNumStat(unstagedOutput));

    await Promise.all(
      parsed.files.map(async file => {
        const statValue = numStats.get(file.path);
        if (statValue) {
          file.additions = statValue.additions;
          file.deletions = statValue.deletions;
        } else if (file.worktreeStatus === CodingGitFileStatus.Untracked) {
          file.additions = await countUntrackedLines(repositoryRoot, file.path);
          file.deletions = 0;
        } else {
          file.additions = 0;
          file.deletions = 0;
        }
      }),
    );

    return {
      isRepository: true,
      targetRoot,
      repositoryRoot,
      branch: parsed.branch,
      head: parsed.head,
      detached: parsed.detached,
      upstream: parsed.upstream,
      ahead: parsed.ahead,
      behind: parsed.behind,
      additions: parsed.files.reduce((total, file) => total + (file.additions ?? 0), 0),
      deletions: parsed.files.reduce((total, file) => total + (file.deletions ?? 0), 0),
      files: parsed.files,
      isIsolated: context.isIsolated,
      isBusy: context.isBusy,
      canMutate: !context.isIsolated && !context.isBusy,
    };
  }

  async getDiff(input: CodingGitDiffInput & { targetRoot: string }): Promise<string> {
    const [filePath] = requireRelativePaths([input.path]);
    let args: string[];
    switch (input.scope) {
      case CodingGitDiffScope.Staged:
        args = ['diff', '--cached', '--binary', '--', filePath];
        break;
      case CodingGitDiffScope.Untracked:
        args = ['diff', '--no-index', '--binary', '--', '/dev/null', filePath];
        break;
      default:
        args = ['diff', '--binary', '--', filePath];
    }
    const result = await runGit(input.targetRoot, args, {
      acceptedExitCodes: input.scope === CodingGitDiffScope.Untracked ? [0, 1] : [0],
      maxOutputBytes: MAX_DIFF_OUTPUT_BYTES,
    });
    return result.stdout;
  }

  async stage(targetRoot: string, paths: string[]): Promise<void> {
    await runGit(targetRoot, ['add', '--', ...requireRelativePaths(paths)]);
  }

  async unstage(targetRoot: string, paths: string[]): Promise<void> {
    const safePaths = requireRelativePaths(paths);
    const hasHead = await runGit(targetRoot, ['rev-parse', '--verify', 'HEAD'], {
      acceptedExitCodes: [0, 128],
    }).then(result => result.exitCode === 0);
    await runGit(
      targetRoot,
      hasHead ? ['reset', '--', ...safePaths] : ['rm', '--cached', '-r', '--', ...safePaths],
    );
  }

  async commit(targetRoot: string, message: string): Promise<void> {
    const value = message.trim();
    if (!value) throw new Error('A Git commit message is required.');
    if (value.length > 10_000) throw new Error('The Git commit message is too long.');
    await runGit(targetRoot, ['commit', '-m', value]);
  }

  async push(targetRoot: string): Promise<void> {
    await runGit(targetRoot, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']);
    await runGit(targetRoot, ['push']);
  }
}
