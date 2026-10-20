import { MAGPIE_ROUTING_GROUP_PREFIX } from '../../shared/magpie/routingUsage';
import type { MagpieRoutingGroup } from '../../shared/magpie/routingUsage';
import type { MagpieModel } from '../../shared/magpie/types';

const MAX_GROUP_DEPTH = 24;

export function memberModelRef(memberId: string): string {
  if (memberId.startsWith(MAGPIE_ROUTING_GROUP_PREFIX)) return memberId;
  return memberId.split(':')[0] ?? memberId;
}

export function collectRoutingGroupLeaves(
  groupId: string,
  groupsById: Map<string, MagpieRoutingGroup>,
  depth = 0,
): string[] {
  if (depth > MAX_GROUP_DEPTH) return [];
  const bare = groupId.startsWith(MAGPIE_ROUTING_GROUP_PREFIX)
    ? groupId.slice(MAGPIE_ROUTING_GROUP_PREFIX.length)
    : groupId;
  const group = groupsById.get(bare);
  if (!group) return [];
  const off = new Set(group.off ?? []);
  const leaves: string[] = [];
  for (const member of group.members) {
    if (off.has(member)) continue;
    if (member.startsWith(MAGPIE_ROUTING_GROUP_PREFIX)) {
      leaves.push(...collectRoutingGroupLeaves(member, groupsById, depth + 1));
    } else {
      leaves.push(memberModelRef(member));
    }
  }
  return leaves;
}

/** Enterprise policy applies to leaf models, not a routing group's display label. */
export function routingGroupAllowed(
  model: MagpieModel,
  groupsById: Map<string, MagpieRoutingGroup>,
  allowedModel?: (model: MagpieModel) => boolean,
): boolean {
  if (!allowedModel) return true;
  if (!model.id.startsWith(MAGPIE_ROUTING_GROUP_PREFIX)) return allowedModel(model);
  const bare = model.id.slice(MAGPIE_ROUTING_GROUP_PREFIX.length);
  const leaves = collectRoutingGroupLeaves(bare, groupsById);
  if (leaves.length === 0) return allowedModel(model);
  return leaves.every(leaf => allowedModel({ ...model, id: leaf, display_name: undefined }));
}
