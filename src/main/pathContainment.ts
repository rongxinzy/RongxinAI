import path from 'path';

/**
 * Inclusive path containment: `target` equals or lies below `root`.
 *
 * The naive check (`!relative.startsWith('..' + path.sep)`) misses the case
 * where `path.relative` cannot express the relationship and returns an
 * absolute path instead — on Windows that happens across drives (`C:\a` vs
 * `D:\b`) and across UNC shares, and such a candidate must count as outside.
 */
export function isPathInside(target: string, root: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
