import type { MemoryMaintenanceBudget } from './markdownMemoryRuntime';

/** Keep UI identity and confirmation boundaries while the upstream target
 * validates/applies operations, enforces its loss bound and creates versions. */
export function protectMemoryCuration(
  budget: MemoryMaintenanceBudget,
  entries: readonly string[],
): MemoryMaintenanceBudget {
  const governed = entries.filter(entry => /^\[memory:\d+\] /.test(entry));
  if (!governed.length) return budget;
  return {
    ...budget,
    run: async (input, tools) => {
      const result = await budget.run(
        `${input}\n\nKeep each [memory:<id>] prefix unchanged. ` +
          'This pass may replace or remove existing entries; new facts require the normal confirmation flow.',
        tools,
      );
      if (result.status !== 'completed') return result;
      try {
        const first = result.text.indexOf('[');
        const last = result.text.lastIndexOf(']');
        const ops = JSON.parse(result.text.slice(first, last + 1));
        if (!Array.isArray(ops)) return { ...result, status: 'rejected', text: '' };
        for (const op of ops) {
          if (op.op === 'add') return { ...result, status: 'rejected', text: '' };
          if (op.op !== 'replace') continue;
          const previous = governed.filter(entry => entry.includes(op.match));
          if (previous.length === 0 && /\[memory:\d+\]/.test(String(op.text)))
            return { ...result, status: 'rejected', text: '' };
          if (
            previous.some(entry => {
              const id = /^\[memory:\d+\]/.exec(entry)![0];
              return (
                typeof op.text !== 'string' ||
                !op.text.startsWith(`${id} `) ||
                (op.text.match(/\[memory:\d+\]/g) ?? []).length !== 1
              );
            })
          )
            return { ...result, status: 'rejected', text: '' };
        }
        return result;
      } catch {
        return { ...result, status: 'rejected', text: '' };
      }
    },
  };
}
