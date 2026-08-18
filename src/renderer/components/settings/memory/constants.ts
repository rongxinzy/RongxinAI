import { MemoryLifecycleStatus, MemoryScope } from '../../../../shared/memory';

export const ManagedMemoryView = {
  LongTerm: 'long_term',
  Session: 'session',
} as const;

export type ManagedMemoryView = (typeof ManagedMemoryView)[keyof typeof ManagedMemoryView];

export const ManagedMemoryScopeFilter = {
  All: 'all',
  Personal: MemoryScope.Personal,
  Project: MemoryScope.Project,
} as const;

export type ManagedMemoryScopeFilter =
  (typeof ManagedMemoryScopeFilter)[keyof typeof ManagedMemoryScopeFilter];

export const ManagedMemoryStatusFilter = {
  All: 'all',
  NeedsReview: MemoryLifecycleStatus.NeedsReview,
  Active: MemoryLifecycleStatus.Active,
  Inactive: 'inactive',
} as const;

export type ManagedMemoryStatusFilter =
  (typeof ManagedMemoryStatusFilter)[keyof typeof ManagedMemoryStatusFilter];
