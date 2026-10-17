import { MemoryScope, type ManagedMemoryRecord } from '../../shared/memory';
import type { ConfirmPayload } from './memoryOutboxPayloads';
import {
  assertCanPromote,
  assertCanSupersede,
  type MemoryRelationshipIdentity,
} from './memoryRelationshipRules';
import type { MemoryRepository } from './repository';

export function resolveReferencedMemoryLink(
  repository: MemoryRepository,
  label: string,
  linkId: string | undefined,
  memoryId: number | undefined,
): ManagedMemoryRecord | null {
  if (!linkId && memoryId === undefined) return null;
  const byLinkId = linkId ? repository.getLink(linkId) : null;
  const byMemoryId = memoryId === undefined ? null : repository.findLinkByMemoryId(memoryId);
  if (linkId && !byLinkId) throw new Error(`${label} was not found.`);
  if (memoryId !== undefined && !byMemoryId) throw new Error(`${label} was not found.`);
  if (byLinkId && byMemoryId && byLinkId.id !== byMemoryId.id) {
    throw new Error(`${label} references do not identify the same memory.`);
  }
  return byLinkId ?? byMemoryId;
}

export function validateMemoryCandidateRelationships(
  repository: MemoryRepository,
  candidate: ManagedMemoryRecord,
  details: {
    supersedesLinkId: string | null;
    promotedFromLinkId: string | null;
    promotionSourceProjectId: string | null;
    promotionSourceSessionId: string | null;
  },
): { superseded: ManagedMemoryRecord | null; promotedFrom: ManagedMemoryRecord | null } {
  const superseded = details.supersedesLinkId ? repository.getLink(details.supersedesLinkId) : null;
  if (details.supersedesLinkId && !superseded) {
    throw new Error('Superseded memory was not found.');
  }
  if (superseded) assertCanSupersede(candidate, superseded);

  const promotedFrom = validatePromotionRelationship(repository, {
    destination: candidate,
    promotedFromLinkId: details.promotedFromLinkId,
    sourceProjectId: details.promotionSourceProjectId,
    sourceSessionId: details.promotionSourceSessionId,
    originSessionId: candidate.sessionId,
  });
  return { superseded, promotedFrom };
}

function validatePromotionRelationship(
  repository: MemoryRepository,
  input: {
    destination: MemoryRelationshipIdentity;
    promotedFromLinkId: string | null | undefined;
    sourceProjectId: string | null | undefined;
    sourceSessionId: string | null | undefined;
    originSessionId: string | undefined;
  },
): ManagedMemoryRecord | null {
  const hasPromotionProvenance = Boolean(
    input.promotedFromLinkId || input.sourceProjectId || input.sourceSessionId,
  );
  if (!hasPromotionProvenance) return null;
  if (!input.promotedFromLinkId || !input.sourceProjectId || !input.originSessionId) {
    throw new Error('Promotion provenance is incomplete.');
  }
  const promotedFrom = repository.getLink(input.promotedFromLinkId);
  if (!promotedFrom) throw new Error('Promotion source was not found.');
  assertCanPromote(input.destination, promotedFrom, input.sourceProjectId, input.originSessionId);
  const sourceSessionId =
    promotedFrom.scope === MemoryScope.Session ? promotedFrom.sessionId : null;
  if (sourceSessionId !== (input.sourceSessionId ?? null)) {
    throw new Error('Promotion source provenance no longer matches the source memory.');
  }
  return promotedFrom;
}

export function validateMemoryOutboxRelationships(
  repository: MemoryRepository,
  payload: ConfirmPayload,
): {
  superseded: ManagedMemoryRecord | null;
} {
  const identity: MemoryRelationshipIdentity = payload;
  const superseded = resolveReferencedMemoryLink(
    repository,
    'Superseded memory',
    payload.supersedesLinkId,
    payload.supersededObservationId,
  );
  if (superseded) assertCanSupersede(identity, superseded);

  validatePromotionRelationship(repository, {
    destination: identity,
    promotedFromLinkId: payload.promotedFromLinkId,
    sourceProjectId: payload.promotionSourceProjectId,
    sourceSessionId: payload.promotionSourceSessionId,
    originSessionId: payload.promotionOriginSessionId,
  });
  return { superseded };
}
