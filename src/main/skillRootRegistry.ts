import path from 'node:path';

export class SkillRootRegistry {
  readonly #registrations = new Map<string, number>();

  register(root: string): () => void {
    if (!path.isAbsolute(root)) throw new Error('Additional Skill roots must be absolute.');
    const resolved = path.resolve(root);
    this.#registrations.set(resolved, (this.#registrations.get(resolved) ?? 0) + 1);
    let registered = true;
    return () => {
      if (!registered) return;
      registered = false;
      const remaining = (this.#registrations.get(resolved) ?? 1) - 1;
      if (remaining === 0) this.#registrations.delete(resolved);
      else this.#registrations.set(resolved, remaining);
    };
  }

  appendTo(roots: readonly string[]): string[] {
    const result = roots.map(root => path.resolve(root));
    const known = new Set(result);
    for (const root of this.#registrations.keys()) {
      if (known.has(root)) continue;
      known.add(root);
      result.push(root);
    }
    return result;
  }
}

export const skillRootRegistry = new SkillRootRegistry();
