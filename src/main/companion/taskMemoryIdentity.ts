import path from 'node:path';
import type Database from 'better-sqlite3';
import { MemoryScope } from '../../shared/memory';
import type { SessionMemoryIdentityResolver } from '../memory/memoryReadService';
import { companionMemoryIdentity } from './memory';
import { initializeCompanionTaskAdmissions, resolveCompanionTaskOwner } from './taskOwnership';

/** A task keeps its admitted owner even when continued from the workbench or after restart. */
export function companionTaskMemoryResolver(
  db: Database.Database,
  companionsDirectory: string,
): SessionMemoryIdentityResolver {
  initializeCompanionTaskAdmissions(db);
  return sessionId => {
    const petId = resolveCompanionTaskOwner(db, sessionId);
    if (!petId) return null;
    const owner = companionMemoryIdentity(petId);
    return {
      scope: MemoryScope.Companion,
      project: {
        id: owner.projectId,
        root: path.join(companionsDirectory, owner.petId),
        displayName: 'Companion',
      },
    };
  };
}
