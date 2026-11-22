import {
  MAGPIE_ROUTING_GROUP_PREFIX,
  MagpieProviderRouting,
} from '../../shared/magpie/routingUsage';
import type { MagpieRoutingGroup } from '../../shared/magpie/routingUsage';
import type { MagpieModel } from '../../shared/magpie/types';

const MAX_GROUP_DEPTH = 24;

function memberModelRef(memberId: string): string {
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

export function routingGroupIdForModel(
  modelId: string,
  groupsById: ReadonlyMap<string, MagpieRoutingGroup>,
): string | undefined {
  if (modelId.startsWith(MAGPIE_ROUTING_GROUP_PREFIX))
    return modelId.slice(MAGPIE_ROUTING_GROUP_PREFIX.length);
  // Exact bare group IDs outrank provider models in the gateway.
  const bare = modelId.toLowerCase();
  return !bare.includes('/') && groupsById.has(bare) ? bare : undefined;
}

export function workRouteModelId(
  model: MagpieModel,
  groupsById: ReadonlyMap<string, MagpieRoutingGroup>,
): string | undefined {
  const groupId = routingGroupIdForModel(model.id, groupsById);
  if (groupId !== undefined) {
    const groupRef = `${MAGPIE_ROUTING_GROUP_PREFIX}${groupId}`;
    return model.canonical_id && model.canonical_id !== groupRef ? undefined : groupRef;
  }
  const id = model.canonical_id ?? model.id;
  if (id.startsWith(MAGPIE_ROUTING_GROUP_PREFIX)) return id;
  if (!id.includes('/') || (model.owned_by && !id.startsWith(`${model.owned_by}/`))) return;
  return id;
}

/** Null means the management snapshot could not account for every reachable member. */
export function collectRoutableGroupModels(
  groupId: string,
  groupsById: ReadonlyMap<string, MagpieRoutingGroup>,
): Set<string> | null {
  const models = new Set<string>();
  const visited = new Set<string>();
  function visit(id: string): boolean {
    if (visited.has(id)) return true;
    visited.add(id);
    const group = groupsById.get(id);
    if (!group) return false;
    if (group.disabled) return true;
    const manual = group.routing === MagpieProviderRouting.Manual;
    let members = group.members;
    if (manual && group.picked) {
      members = [group.picked];
    } else if (group.membersIncomplete || (manual && members.length)) {
      return false;
    } else if (group.off?.length) {
      const off = new Set(group.off);
      members = members.filter(member => !off.has(member));
    }
    const infoById = new Map(group.memberInfo.map(info => [info.id, info]));
    for (const member of members) {
      if (member.startsWith(MAGPIE_ROUTING_GROUP_PREFIX)) {
        if (!visit(member.slice(MAGPIE_ROUTING_GROUP_PREFIX.length))) return false;
        continue;
      }
      const info = infoById.get(member);
      if (!info) return false;
      if (!info.ready) continue;
      if (!info.provider || !info.model) return false;
      models.add(`${info.provider}/${info.model}`);
    }
    return true;
  }
  return visit(groupId) ? models : null;
}
