import type { MagpieRoutingModelRef } from '../../../../shared/magpie/routingUsage';

export function memberSelectItems(
  catalog: MagpieRoutingModelRef[],
  memberIds: string[],
): Record<string, string> {
  const items = Object.fromEntries(catalog.map(model => [model.id, model.name]));
  for (const id of memberIds) {
    if (id && !(id in items)) items[id] = id;
  }
  return items;
}

export function membersEqual(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
