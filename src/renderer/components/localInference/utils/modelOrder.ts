import { LOCAL_INFERENCE_MODEL_ORDER_STORAGE_KEY } from '../constants';

export function readLocalModelOrder(): string[] {
  try {
    const raw = localStorage.getItem(LOCAL_INFERENCE_MODEL_ORDER_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return uniqueModelNames(parsed);
  } catch {
    return [];
  }
}

export function writeLocalModelOrder(order: readonly string[]): void {
  try {
    localStorage.setItem(
      LOCAL_INFERENCE_MODEL_ORDER_STORAGE_KEY,
      JSON.stringify(uniqueModelNames(order)),
    );
  } catch {
    // Ignore storage failures and keep the live order usable.
  }
}

export function reconcileLocalModelOrder(
  availableModelNames: readonly string[],
  savedOrder: readonly string[],
): string[] {
  const available = uniqueModelNames(availableModelNames);
  const availableSet = new Set(available);
  const saved = uniqueModelNames(savedOrder).filter(name => availableSet.has(name));
  const savedSet = new Set(saved);
  return [...saved, ...available.filter(name => !savedSet.has(name))];
}

export function reorderLocalModelOrder(
  order: readonly string[],
  sourceModelName: string,
  targetModelName: string,
): string[] {
  if (sourceModelName === targetModelName) return [...order];
  const sourceIndex = order.indexOf(sourceModelName);
  const targetIndex = order.indexOf(targetModelName);
  if (sourceIndex === -1 || targetIndex === -1) return [...order];

  const next = [...order];
  next.splice(sourceIndex, 1);
  next.splice(targetIndex, 0, sourceModelName);
  return next;
}

function uniqueModelNames(values: readonly unknown[]): string[] {
  const unique = new Set<string>();
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const name = value.trim();
    if (name) unique.add(name);
  }
  return Array.from(unique);
}
