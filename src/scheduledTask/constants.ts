/**
 * Centralized constants for the scheduledTask module.
 *
 * Every discriminated-union kind value, delivery mode, session target, wake mode,
 * status code, IPC channel name, and magic string lives here as an `as const`
 * object.  Types are derived from these objects so that values and types share
 * a single source of truth.
 *
 * Usage:
 *   import { ScheduleKind, SessionTarget } from './constants';
 *   const s: SessionTarget = SessionTarget.Main;
 */

// ─── Schedule Kind ──────────────────────────────────────────────────────────
export const ScheduleKind = {
  At: 'at',
  Every: 'every',
  Cron: 'cron',
} as const;
export type ScheduleKind = (typeof ScheduleKind)[keyof typeof ScheduleKind];

// ─── Payload Kind ───────────────────────────────────────────────────────────
export const PayloadKind = {
  AgentTurn: 'agentTurn',
  SystemEvent: 'systemEvent',
} as const;
export type PayloadKind = (typeof PayloadKind)[keyof typeof PayloadKind];

// ─── Delivery Mode ──────────────────────────────────────────────────────────
export const DeliveryMode = {
  None: 'none',
  Announce: 'announce',
  Webhook: 'webhook',
} as const;
export type DeliveryMode = (typeof DeliveryMode)[keyof typeof DeliveryMode];

// ─── Session Target ─────────────────────────────────────────────────────────
export const SessionTarget = {
  Main: 'main',
  Isolated: 'isolated',
  Task: 'task',
} as const;
export type SessionTarget = (typeof SessionTarget)[keyof typeof SessionTarget];

export const SessionBindingStrategy = {
  PerRun: 'per-run',
  Task: 'task',
  Existing: 'existing',
} as const;
export type SessionBindingStrategy =
  (typeof SessionBindingStrategy)[keyof typeof SessionBindingStrategy];

export const ManagedSessionKeyPrefix = {
  Zhiyuan: 'zhiyuan:',
} as const;

// ─── Wake Mode ──────────────────────────────────────────────────────────────
export const WakeMode = {
  Now: 'now',
  NextHeartbeat: 'next-heartbeat',
} as const;
export type WakeMode = (typeof WakeMode)[keyof typeof WakeMode];

// ─── Task / Run Status ──────────────────────────────────────────────────────
export const TaskStatus = {
  Success: 'success',
  Error: 'error',
  Skipped: 'skipped',
  Running: 'running',
} as const;
export type TaskStatus = (typeof TaskStatus)[keyof typeof TaskStatus];

export const DeliveryStatus = {
  Pending: 'pending',
  Success: 'success',
  Error: 'error',
  Skipped: 'skipped',
} as const;
export type DeliveryStatus = (typeof DeliveryStatus)[keyof typeof DeliveryStatus];

// ─── IPC Channels ───────────────────────────────────────────────────────────
export const IpcChannel = {
  List: 'scheduledTask:list',
  Get: 'scheduledTask:get',
  Create: 'scheduledTask:create',
  Update: 'scheduledTask:update',
  Delete: 'scheduledTask:delete',
  Toggle: 'scheduledTask:toggle',
  RunManually: 'scheduledTask:runManually',
  Stop: 'scheduledTask:stop',
  ListRuns: 'scheduledTask:listRuns',
  ListDeliveries: 'scheduledTask:listDeliveries',
  CountRuns: 'scheduledTask:countRuns',
  ListAllRuns: 'scheduledTask:listAllRuns',
  ResolveSession: 'scheduledTask:resolveSession',
  ListChannels: 'scheduledTask:listChannels',
  ListChannelConversations: 'scheduledTask:listChannelConversations',
  Preflight: 'scheduledTask:preflight',
  StatusUpdate: 'scheduledTask:statusUpdate',
  RunUpdate: 'scheduledTask:runUpdate',
  Refresh: 'scheduledTask:refresh',
} as const;
