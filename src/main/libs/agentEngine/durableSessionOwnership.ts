/** Process-local ownership complements SQLite's lock and serializes close/delete/reopen. */
export interface DurableStorageOwner {
  readonly closing: Promise<void> | null;
  /** True only after the owned backend's close operation completed successfully. */
  readonly storageClosed: boolean;
  close(): Promise<void>;
}

type Barrier = { readonly released: Promise<void> };
const owners = new Map<string, DurableStorageOwner | Barrier>();

export async function claimDurableStorage(file: string, owner: DurableStorageOwner): Promise<void> {
  for (;;) {
    const previous = owners.get(file);
    if (!previous) {
      owners.set(file, owner);
      return;
    }
    if ('released' in previous) await previous.released;
    else if (previous.closing) {
      try {
        await previous.closing;
        if (owners.get(file) === previous) {
          if (previous.storageClosed) owners.delete(file);
          else throw new Error('Native storage did not close safely.');
        }
      } catch (error) {
        if (owners.get(file) === previous) throw error;
      }
    } else throw new Error('Durable storage already has an owner.');
  }
}

export function releaseDurableStorage(file: string, owner: DurableStorageOwner): void {
  if (owners.get(file) === owner) owners.delete(file);
}

export async function withClosedDurableStorage(file: string, action: () => void): Promise<void> {
  for (;;) {
    const previous = owners.get(file);
    if (previous && 'released' in previous) {
      await previous.released;
      continue;
    }
    const previousOwner = previous && 'close' in previous ? previous : undefined;
    let release!: () => void;
    const barrier: Barrier = {
      released: new Promise<void>(resolve => {
        release = resolve;
      }),
    };
    owners.set(file, barrier);
    try {
      if (previousOwner) {
        await previousOwner.close();
        if (!previousOwner.storageClosed) throw new Error('Native storage did not close safely.');
      }
      action();
    } finally {
      if (owners.get(file) === barrier) {
        // A failed native close may still hold SQLite resources. Keep that owner
        // so neither another opener nor an invalidation can bypass its failure.
        if (previousOwner && !previousOwner.storageClosed) owners.set(file, previousOwner);
        else owners.delete(file);
      }
      release();
    }
    return;
  }
}
