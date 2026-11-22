import { realpath } from 'fs/promises';
import path from 'path';

function containsPath(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

/** A directory diff cannot attribute changes in the intersection of two active runs. */
export class WorkspaceObservations {
  private readonly active = new Set<{
    canonicalRoot: Promise<string>;
    sharedRoots: Set<string>;
    comparisons: Set<Promise<void>>;
    root: string;
  }>();

  begin(root: string) {
    const observation = {
      canonicalRoot: realpath(root).catch(() => path.resolve(root)),
      sharedRoots: new Set<string>(),
      comparisons: new Set<Promise<void>>(),
      root,
    };

    for (const peer of this.active) {
      const comparison = Promise.all([observation.canonicalRoot, peer.canonicalRoot])
        .then(([current, other]) => {
          if (containsPath(current, other)) {
            observation.sharedRoots.add(path.resolve(root, path.relative(current, other)));
            peer.sharedRoots.add(peer.root);
          } else if (containsPath(other, current)) {
            observation.sharedRoots.add(root);
            peer.sharedRoots.add(path.resolve(peer.root, path.relative(other, current)));
          }
        })
        .finally(() => {
          observation.comparisons.delete(comparison);
          peer.comparisons.delete(comparison);
        });
      observation.comparisons.add(comparison);
      peer.comparisons.add(comparison);
    }
    this.active.add(observation);

    return {
      async compareRoots(): Promise<void> {
        while (observation.comparisons.size > 0) {
          await Promise.all(observation.comparisons);
        }
      },
      canAttribute(filePath: string): boolean {
        return (
          observation.comparisons.size === 0 &&
          ![...observation.sharedRoots].some(sharedRoot => containsPath(sharedRoot, filePath))
        );
      },
      release: () => this.active.delete(observation),
    };
  }
}
