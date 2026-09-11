import { spawn } from 'child_process';
import { lstat, readFile, stat } from 'fs/promises';
import path from 'path';

import {
  CodingGitDiffScope,
  CodingGitFileStatus,
  type CodingGitDiffInput,
  type CodingGitPullRequestInput,
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

interface CommandOptions {
  acceptedExitCodes?: number[];
  maxOutputBytes?: number;
  env?: NodeJS.ProcessEnv;
}

const runCommand = async (
  command: string,
  cwd: string,
  args: string[],
  options: CommandOptions = {},
): Promise<GitCommandResult> => {
  const acceptedExitCodes = options.acceptedExitCodes ?? [0];
  const maxOutputBytes = options.maxOutputBytes ?? MAX_GIT_OUTPUT_BYTES;
  return await new Promise<GitCommandResult>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        ...options.env,
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
          reject(
            new Error(
              stderr.trim() || stdout.trim() || `${command} ${args[0]} failed with exit code ${exitCode}.`,
            ),
          );
        }
      });
    });
    const timeout = setTimeout(() => {
      child.kill();
      finish(() => reject(new Error(`${command} ${args[0]} timed out.`)));
    }, GIT_COMMAND_TIMEOUT_MS);
  });
};

const runGit = async (
  cwd: string,
  args: string[],
  options: { acceptedExitCodes?: number[]; maxOutputBytes?: number } = {},
): Promise<GitCommandResult> =>
  await runCommand('git', cwd, args, {
    ...options,
    env: {
      GIT_TERMINAL_PROMPT: '0',
      LC_ALL: 'C',
      LANG: 'C',
    },
  });

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
    if (value === '.' || path.isAbsolute(value) || value.split(/[\\/]/).includes('..')) {
      throw new Error('Git paths must stay inside the selected repository.');
    }
  }
  return values;
};

const isMissingFileError = (error: unknown): boolean =>
  error instanceof Error && 'code' in error && error.code === 'ENOENT';

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

const toGitHubRepositoryUrl = (remote: string): string | null => {
  const httpsMatch = /^https:\/\/github\.com\/([^\s]+)$/.exec(remote.trim());
  const sshMatch = /^git@github\.com:([^\s]+)$/.exec(remote.trim());
  const repositoryPath = httpsMatch?.[1] ?? sshMatch?.[1];
  if (!repositoryPath) return null;
  const normalizedPath = repositoryPath.replace(/\.git$/, '').replace(/\/+$/, '');
  if (!normalizedPath || normalizedPath.includes('..')) return null;
  return `https://github.com/${normalizedPath}`;
};

export class CodingGitService {
  async createPullRequest(
    targetRoot: string,
    input: Omit<CodingGitPullRequestInput, 'workspaceRoot' | 'laneId' | 'sourceRoot'>,
  ): Promise<string> {
    const title = input.title.trim();
    const base = input.base.trim();
    if (!title || !base) throw new Error('A pull request title and base branch are required.');
    const args = ['pr', 'create', '--base', base, '--title', title];
    if (input.body.trim()) {
      args.push('--body', input.body);
    } else {
      args.push('--fill');
    }
    if (input.draft) args.push('--draft');
    const result = await runCommand(
      'gh',
      targetRoot,
      args,
      { env: { GH_PROMPT_DISABLED: '1' }, maxOutputBytes: MAX_GIT_OUTPUT_BYTES },
    );
    const url = result.stdout.trim().split(/\s+/).find(value => value.startsWith('https://'));
    if (!url) throw new Error('GitHub did not return a pull request URL.');
    return url;
  }

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
        githubRepositoryUrl: null,
        hasOrigin: false,
        hasRemoteBranch: false,
        defaultBranch: null,
        branch: null,
        localBranches: [],
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
    const [stagedOutput, unstagedOutput, originRemoteOutput, localBranchesOutput, originHeadOutput] = await Promise.all([
      runGit(targetRoot, ['diff', '--no-ext-diff', '--cached', '--numstat', '-z']).then(
        result => result.stdout,
      ),
      runGit(targetRoot, ['diff', '--no-ext-diff', '--numstat', '-z']).then(
        result => result.stdout,
      ),
      runGit(targetRoot, ['remote', 'get-url', 'origin'], { acceptedExitCodes: [0, 2] }).then(
        result => result.stdout,
      ),
      runGit(targetRoot, ['for-each-ref', '--format=%(refname:short)', 'refs/heads/']).then(
        result => result.stdout,
      ),
      runGit(targetRoot, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'], {
        acceptedExitCodes: [0, 1, 128],
      }).then(result => result.stdout),
    ]);
    const numStats = parseNumStat(stagedOutput);
    mergeNumStats(numStats, parseNumStat(unstagedOutput));
    const remoteTrackingHead =
      Boolean(originRemoteOutput.trim()) && Boolean(parsed.branch)
        ? await runGit(
            targetRoot,
            ['rev-parse', '--verify', `refs/remotes/origin/${parsed.branch}`],
            { acceptedExitCodes: [0, 128] },
          ).then(result => (result.exitCode === 0 ? result.stdout.trim() : null))
        : null;
    const hasRemoteBranch = remoteTrackingHead !== null && remoteTrackingHead === parsed.head;
    const localBranches = localBranchesOutput.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
    const defaultBranch = originHeadOutput.trim().replace(/^origin\//, '') ||
      (localBranches.includes('main') ? 'main' : localBranches.includes('master') ? 'master' : null);

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
      githubRepositoryUrl: toGitHubRepositoryUrl(originRemoteOutput),
      hasOrigin: Boolean(originRemoteOutput.trim()),
      hasRemoteBranch,
      defaultBranch,
      branch: parsed.branch,
      localBranches,
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
        args = ['diff', '--no-ext-diff', '--cached', '--binary', '--', filePath];
        break;
      case CodingGitDiffScope.Untracked:
        args = ['diff', '--no-ext-diff', '--no-index', '--binary', '--', '/dev/null', filePath];
        break;
      default:
        args = ['diff', '--no-ext-diff', '--binary', '--', filePath];
    }
    const result = await runGit(input.targetRoot, args, {
      acceptedExitCodes: input.scope === CodingGitDiffScope.Untracked ? [0, 1] : [0],
      maxOutputBytes: MAX_DIFF_OUTPUT_BYTES,
    });
    return result.stdout;
  }

  async stage(targetRoot: string, paths: string[]): Promise<void> {
    const safePaths = requireRelativePaths(paths);
    await runGit(targetRoot, ['add', '--', ...safePaths]);
    for (const safePath of safePaths) {
      const staged = await runGit(targetRoot, ['diff', '--cached', '--name-only', '-z', '--', safePath]);
      if (staged.stdout.split('\0').some(value => value === safePath)) continue;
      const absolutePath = path.resolve(targetRoot, safePath);
      try {
        const fileStat = await lstat(absolutePath);
        if (!fileStat.isFile()) {
          throw new Error('Git could not safely stage the selected non-file path.');
        }
        const mode = (fileStat.mode & 0o111) !== 0 ? '100755' : '100644';
        const hash = (await runGit(targetRoot, ['hash-object', '-w', '--', safePath])).stdout.trim();
        await runGit(targetRoot, ['update-index', '--add', '--cacheinfo', `${mode},${hash},${safePath}`]);
      } catch (error) {
        if (!isMissingFileError(error)) throw error;
        await runGit(targetRoot, ['update-index', '--force-remove', '--', safePath]);
      }
    }
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

  async commit(targetRoot: string, message: string, paths: string[]): Promise<void> {
    const value = message.trim();
    if (!value) throw new Error('A Git commit message is required.');
    if (value.length > 10_000) throw new Error('The Git commit message is too long.');
    if (paths.length > 0) {
      await this.stage(targetRoot, paths);
      const stagedPaths = await runGit(targetRoot, ['diff', '--cached', '--name-only']);
      console.debug(
        `[CodingGit] staged ${stagedPaths.stdout.trim() || 'no paths'} in ${targetRoot}`,
      );
    }
    await runGit(targetRoot, ['commit', '-m', value]);
  }

  async commitAndPush(
    targetRoot: string,
    message: string,
    paths: string[],
  ): Promise<{ pushed: boolean; pushError?: string }> {
    await this.commit(targetRoot, message, paths);
    try {
      await this.push(targetRoot);
      return { pushed: true };
    } catch (error) {
      console.error('[CodingGit] push failed after the local commit completed:', error);
      return {
        pushed: false,
        pushError: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async push(targetRoot: string): Promise<void> {
    const origin = await runGit(targetRoot, ['remote', 'get-url', 'origin'], {
      acceptedExitCodes: [0, 2],
    });
    if (origin.exitCode !== 0) {
      throw new Error('No origin remote is configured for the current repository.');
    }

    const branch = (await runGit(targetRoot, ['branch', '--show-current'])).stdout.trim();
    if (!branch) {
      throw new Error('The detached HEAD cannot be pushed without selecting a branch.');
    }
    // Establish the upstream on the first push. Git then owns the remote-tracking
    // ref; a local cache update must never turn a successful remote push into a
    // reported failure.
    await runGit(targetRoot, ['push', '--set-upstream', 'origin', branch]);
  }

  async switchBranch(targetRoot: string, branch: string): Promise<void> {
    const value = branch.trim();
    if (!value || value.startsWith('-')) throw new Error('Invalid Git branch.');
    await runGit(targetRoot, ['check-ref-format', '--branch', value]);
    await runGit(targetRoot, ['switch', '--', value]);
  }

  async createBranch(targetRoot: string, branch: string): Promise<void> {
    const value = branch.trim();
    if (!value || value.startsWith('-')) throw new Error('Invalid Git branch.');
    await runGit(targetRoot, ['check-ref-format', '--branch', value]);
    await runGit(targetRoot, ['switch', '--create', value]);
  }
}
