import { mkdir } from 'fs/promises';
import path from 'path';
import { spawn } from 'child_process';

const MAX_DIFF_PREVIEW_BYTES = 256 * 1024;
const DIFF_TRUNCATION_MARKER = '\n\n[Diff preview truncated]\n';

const runGit = async (cwd: string, args: string[]): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('git', args, { cwd, shell: false, stdio: 'ignore' });
    child.once('error', reject);
    child.once('exit', code =>
      code === 0 ? resolve() : reject(new Error(`git ${args[0]} failed with exit code ${code}.`)),
    );
  });
};

const readGit = async (cwd: string, args: string[]): Promise<string> => {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn('git', args, { cwd, shell: false, stdio: ['ignore', 'pipe', 'ignore'] });
    let output = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      output += chunk;
    });
    child.once('error', reject);
    child.once('exit', code =>
      code === 0
        ? resolve(output.trim())
        : reject(new Error(`git ${args[0]} failed with exit code ${code}.`)),
    );
  });
};

const readGitPatch = async (cwd: string, args: string[]): Promise<string> => {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn('git', args, { cwd, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', chunk => (output += chunk));
    child.stderr.on('data', chunk => (stderr += chunk));
    child.once('error', reject);
    child.once('exit', code =>
      code === 0 || code === 1
        ? resolve(output)
        : reject(new Error(stderr.trim() || `git ${args[0]} failed with exit code ${code}.`)),
    );
  });
};

const listUntrackedFiles = async (cwd: string): Promise<string[]> => {
  const output = await readGit(cwd, ['ls-files', '--others', '--exclude-standard', '-z']);
  return output.split('\0').filter(Boolean);
};

const applyGitPatch = async (cwd: string, patch: string, checkOnly: boolean): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    const args = ['apply', '--whitespace=nowarn'];
    if (checkOnly) args.push('--check');
    const child = spawn('git', args, { cwd, shell: false, stdio: ['pipe', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => {
      stderr += chunk;
    });
    child.once('error', reject);
    child.once('exit', code => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `git apply failed with exit code ${code}.`));
    });
    child.stdin.end(patch);
  });
};

/** A checked collaborator patch cannot be safely applied to the primary workspace. */
export class GitWorktreeConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GitWorktreeConflictError';
  }
}

/** Creates application-managed, lane-specific Git worktrees from one immutable baseline. */
export class GitWorktreeService {
  constructor(private readonly rootDirectory: string) {}

  async create(input: {
    repositoryRoot: string;
    baseline: string;
    laneId: string;
  }): Promise<string> {
    const target = path.join(this.rootDirectory, input.laneId);
    await mkdir(this.rootDirectory, { recursive: true });
    await runGit(input.repositoryRoot, ['worktree', 'add', '--detach', target, input.baseline]);
    return target;
  }

  async createAtHead(input: { repositoryRoot: string; laneId: string }): Promise<string> {
    const repositoryRoot = await readGit(input.repositoryRoot, ['rev-parse', '--show-toplevel']);
    const baseline = await GitWorktreeService.getBaseline(repositoryRoot);
    return await this.create({ repositoryRoot, baseline, laneId: input.laneId });
  }

  static async getBaseline(repositoryRoot: string): Promise<string> {
    return await readGit(repositoryRoot, ['rev-parse', 'HEAD']);
  }

  async getWorktreeDiff(worktreeRoot: string): Promise<string> {
    const trackedPatch = await readGit(worktreeRoot, ['diff', '--binary', 'HEAD']);
    const untrackedPatch = await Promise.all(
      (await listUntrackedFiles(worktreeRoot)).map(file =>
        readGitPatch(worktreeRoot, ['diff', '--no-index', '--binary', '--', '/dev/null', file]),
      ),
    );
    return [trackedPatch, ...untrackedPatch].filter(Boolean).join('\n');
  }

  async getWorktreeDiffPreview(worktreeRoot: string): Promise<string> {
    const diff = await this.getWorktreeDiff(worktreeRoot);
    if (Buffer.byteLength(diff, 'utf8') <= MAX_DIFF_PREVIEW_BYTES) return diff;
    return `${Buffer.from(diff, 'utf8').subarray(0, MAX_DIFF_PREVIEW_BYTES).toString('utf8')}${DIFF_TRUNCATION_MARKER}`;
  }

  async applyWorktreeDiff(input: { repositoryRoot: string; worktreeRoot: string }): Promise<void> {
    const patch = await this.getWorktreeDiff(input.worktreeRoot);
    if (!patch.trim()) return;
    try {
      await applyGitPatch(input.repositoryRoot, patch, true);
    } catch (error) {
      throw new GitWorktreeConflictError(
        error instanceof Error ? error.message : 'The collaborator patch cannot be applied cleanly.',
      );
    }
    await applyGitPatch(input.repositoryRoot, patch, false);
  }

  async remove(repositoryRoot: string, worktreePath: string): Promise<void> {
    await runGit(repositoryRoot, ['worktree', 'remove', '--force', worktreePath]);
  }
}
