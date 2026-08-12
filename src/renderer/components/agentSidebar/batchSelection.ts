export const toggleBatchSelection = (selectedIds: ReadonlySet<string>, sessionId: string) => {
  const next = new Set(selectedIds);
  if (next.has(sessionId)) {
    next.delete(sessionId);
  } else {
    next.add(sessionId);
  }
  return next;
};

export const toggleVisibleBatchSelection = (
  selectedIds: ReadonlySet<string>,
  visibleSessionIds: readonly string[],
) => {
  const next = new Set(selectedIds);
  const allVisibleSelected =
    visibleSessionIds.length > 0 && visibleSessionIds.every(id => selectedIds.has(id));

  for (const sessionId of visibleSessionIds) {
    if (allVisibleSelected) {
      next.delete(sessionId);
    } else {
      next.add(sessionId);
    }
  }

  return next;
};
