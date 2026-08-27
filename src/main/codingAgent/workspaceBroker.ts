import { realpath } from 'fs/promises';
import path from 'path';

/** Resolves agent filesystem targets through explicit, real-path boundaries. */
export class WorkspaceBroker {
  private readonly allowedRoots = new Set<string>();
  private readonly workspaceRoot: string;

  constructor(workspaceRoot: string, additionalRoots: string[] = []) {
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.allowedRoots.add(this.workspaceRoot);
    for (const root of additionalRoots) this.allowedRoots.add(path.resolve(root));
  }

  async resolveTarget(target: string): Promise<string> {
    const absolute = path.isAbsolute(target)
      ? path.resolve(target)
      : path.resolve(this.workspaceRoot, target);
    const existing = await this.resolveExistingAncestor(absolute);
    const realRoot = await this.findAuthorizedRoot(existing.realPath);
    if (!realRoot) throw new Error('The target is outside the authorized coding workspace.');

    if (existing.remaining.length === 0) return existing.realPath;
    const resolvedTarget = path.resolve(existing.realPath, ...existing.remaining);
    if (!resolvedTarget.startsWith(`${realRoot}${path.sep}`)) {
      throw new Error('The target is outside the authorized coding workspace.');
    }
    return resolvedTarget;
  }

  private async resolveExistingAncestor(target: string): Promise<{
    realPath: string;
    remaining: string[];
  }> {
    const remaining: string[] = [];
    let candidate = target;
    while (true) {
      try {
        return { realPath: await realpath(candidate), remaining };
      } catch {
        const parent = path.dirname(candidate);
        if (parent === candidate)
          throw new Error('The target does not have an existing filesystem ancestor.');
        remaining.unshift(path.basename(candidate));
        candidate = parent;
      }
    }
  }

  private async findAuthorizedRoot(target: string): Promise<string | null> {
    for (const root of this.allowedRoots) {
      const realRoot = await realpath(root);
      if (target === realRoot || target.startsWith(`${realRoot}${path.sep}`)) return realRoot;
    }
    return null;
  }
}
