/**
 * Detect whether the content looks like a valid unified diff and, if so,
 * split it into original vs modified text for the merge view.
 *
 * To avoid false positives (e.g. a markdown list whose items happen to start
 * with `-` or `+`), we require that the content exhibits clear diff structure:
 *   1. Has a `@@` hunk header, OR
 *   2. Contains BOTH `-` (deletion) and `+` (addition) lines, AND
 *      the ratio of diff-marker lines (`-`, `+`, or leading space context)
 *      to total non-empty lines is at least 60%.
 */
export function parseDiff(raw: string): { original: string; modified: string } | null {
  const lines = raw.split('\n');

  // ── First pass: probe whether this really looks like a diff ──────────
  let hasHunkHeader = false;
  let deletionCount = 0;
  let additionCount = 0;
  let contextCount = 0; // lines starting with a single space (diff context)
  let headerCount = 0; // --- / +++ file headers
  let totalNonEmpty = 0;

  for (const line of lines) {
    if (line.length === 0) continue;
    totalNonEmpty += 1;

    if (line.startsWith('@@')) {
      hasHunkHeader = true;
      headerCount += 1;
    } else if (line.startsWith('---') || line.startsWith('+++')) {
      headerCount += 1;
    } else if (line.startsWith('-')) {
      deletionCount += 1;
    } else if (line.startsWith('+')) {
      additionCount += 1;
    } else if (line.startsWith(' ')) {
      contextCount += 1;
    }
  }

  const hasBothSides = deletionCount > 0 && additionCount > 0;

  if (!hasHunkHeader && !hasBothSides) {
    // Neither a hunk header nor both -/+ lines → not a diff.
    return null;
  }

  if (!hasHunkHeader) {
    // No @@ header — rely on heuristics to avoid false positives.
    // Require that diff-marker lines dominate the content.
    const markerLines = deletionCount + additionCount + contextCount + headerCount;
    if (totalNonEmpty > 0 && markerLines / totalNonEmpty < 0.6) {
      return null;
    }
  }

  // ── Second pass: split into original / modified ──────────────────────
  const originalLines: string[] = [];
  const modifiedLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith('---') || line.startsWith('+++') || line.startsWith('@@')) {
      continue;
    }
    if (line.startsWith('-')) {
      originalLines.push(line.slice(1));
    } else if (line.startsWith('+')) {
      modifiedLines.push(line.slice(1));
    } else {
      const ctx = line.startsWith(' ') ? line.slice(1) : line;
      originalLines.push(ctx);
      modifiedLines.push(ctx);
    }
  }

  return {
    original: originalLines.join('\n'),
    modified: modifiedLines.join('\n'),
  };
}
