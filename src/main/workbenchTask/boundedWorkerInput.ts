/** Visits a fixed maximum number of nodes; rejects oversized inputs before structured cloning. */
export function boundWorkerInput(
  value: unknown,
  limits: { nodes: number; depth: number; characters: number; toolText?: boolean },
): unknown {
  let nodes = 0;
  let characters = 0;
  const seen = new WeakSet<object>();
  const visit = (item: unknown, depth: number): unknown => {
    if (++nodes > limits.nodes || depth > limits.depth)
      throw new Error('Worker input limit exceeded.');
    if (typeof item === 'string') {
      characters += item.length;
      if (characters > limits.characters) throw new Error('Worker input limit exceeded.');
      return item;
    }
    if (!item || typeof item !== 'object') return item;
    if (seen.has(item)) {
      if (limits.toolText) return '[Circular]';
      throw new Error('Worker input must not contain cycles.');
    }
    seen.add(item);
    if (Array.isArray(item)) {
      if (item.length > limits.nodes) throw new Error('Worker input limit exceeded.');
      return item.map(entry => visit(entry, depth + 1));
    }
    const record = item as Record<string, unknown>;
    if (limits.toolText) {
      if (typeof record.text === 'string') return { text: visit(record.text, depth + 1) };
      if (record.content !== undefined) return { content: visit(record.content, depth + 1) };
    }
    const result: Record<string, unknown> = Object.create(null);
    for (const key in record) {
      if (!Object.hasOwn(record, key)) continue;
      characters += key.length;
      if (characters > limits.characters) throw new Error('Worker input limit exceeded.');
      result[key] = visit(record[key], depth + 1);
    }
    seen.delete(item);
    return result;
  };
  return visit(value, 0);
}
