import { lstat, realpath } from 'node:fs/promises';
import path from 'path';

const isOutside = (root: string, target: string): boolean => {
  const relative = path.relative(root, target);
  return relative.split(path.sep)[0] === '..' || path.isAbsolute(relative);
};

export async function resolveWorkspaceFile(workspaceRoot: string, reference: string) {
  if (!reference.trim()) return null;
  const root = path.resolve(workspaceRoot);
  const lexical = path.isAbsolute(reference)
    ? path.normalize(reference)
    : path.resolve(root, reference);
  try {
    const [resolvedRoot, filePath] = await Promise.all([realpath(root), realpath(lexical)]);
    if (isOutside(resolvedRoot, filePath)) return null;
    const stat = await lstat(filePath);
    return stat.isFile() ? { filePath, bytes: stat.size } : null;
  } catch {
    return null;
  }
}
