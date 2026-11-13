import fs from 'fs';
import path from 'path';

const isOutside = (root: string, target: string): boolean => {
  const relative = path.relative(root, target);
  return relative.split(path.sep)[0] === '..' || path.isAbsolute(relative);
};

export const resolveWorkspaceFile = (workspaceRoot: string, reference: string): string | null => {
  if (!reference.trim()) return null;
  const root = path.resolve(workspaceRoot);
  const lexical = path.isAbsolute(reference)
    ? path.normalize(reference)
    : path.resolve(root, reference);
  try {
    const resolvedRoot = fs.realpathSync(root);
    const resolved = fs.realpathSync(lexical);
    const stat = fs.statSync(resolved);
    return isOutside(resolvedRoot, resolved) || !stat.isFile() ? null : resolved;
  } catch {
    return null;
  }
};
