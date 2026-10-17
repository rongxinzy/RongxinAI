// Parsing/normalization helpers shared by the CoworkStore class chain.
// Split from src/main/coworkStore.ts (issue #1069).
import { app } from 'electron';
import fs from 'fs';
import path from 'path';

import {
  CoworkPermissionMode,
  DEFAULT_COWORK_PERMISSION_MODE,
  type CoworkPermissionMode as CoworkPermissionModeType,
} from '../../shared/cowork/constants';
import { getDefaultConversationWorkspacePath } from '../defaultConversationWorkspace';
import type { CoworkMessage, CoworkMessageType } from './types';

// Default working directory for new users
export const getDefaultWorkingDirectory = (): string => {
  return getDefaultConversationWorkspacePath();
};

export const DEFAULT_EMBEDDING_ENABLED = false;
export const DEFAULT_EMBEDDING_PROVIDER = 'openai';
export const DEFAULT_EMBEDDING_MODEL = '';
export const DEFAULT_EMBEDDING_LOCAL_MODEL_PATH = '';
const DEFAULT_EMBEDDING_VECTOR_WEIGHT = 0.7;
export const DEFAULT_EMBEDDING_REMOTE_BASE_URL = '';
export const DEFAULT_EMBEDDING_REMOTE_API_KEY = '';

export function parseBooleanConfig(value: string | undefined, fallback: boolean): boolean {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on')
    return true;
  if (normalized === '0' || normalized === 'false' || normalized === 'no' || normalized === 'off')
    return false;
  return fallback;
}

export function normalizePermissionMode(value: string | undefined): CoworkPermissionModeType {
  if (value === CoworkPermissionMode.Ask || value === CoworkPermissionMode.AllowAll) return value;
  return DEFAULT_COWORK_PERMISSION_MODE;
}

export function parseEmbeddingVectorWeight(value: string | undefined): number {
  if (!value) return DEFAULT_EMBEDDING_VECTOR_WEIGHT;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_EMBEDDING_VECTOR_WEIGHT;
  return Math.max(0, Math.min(1, parsed));
}

function normalizeMemoryText(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

export function extractConversationSearchTerms(value: string): string[] {
  const normalized = normalizeMemoryText(value).toLowerCase();
  if (!normalized) return [];

  const terms: string[] = [];
  const seen = new Set<string>();
  const addTerm = (term: string): void => {
    const normalizedTerm = normalizeMemoryText(term).toLowerCase();
    if (!normalizedTerm) return;
    if (/^[a-z0-9]$/i.test(normalizedTerm)) return;
    if (seen.has(normalizedTerm)) return;
    seen.add(normalizedTerm);
    terms.push(normalizedTerm);
  };

  // Keep the full phrase and additionally match by per-token terms.
  addTerm(normalized);
  const tokens = normalized
    .split(/[\s,，、|/\\;；]+/g)
    .map(token => token.replace(/^['"`]+|['"`]+$/g, '').trim())
    .filter(Boolean);

  for (const token of tokens) {
    addTerm(token);
    if (terms.length >= 8) break;
  }

  return terms.slice(0, 8);
}

export function truncate(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars - 1)}…`;
}

export function parseTimeToMs(input?: string | null): number | null {
  if (!input) return null;
  const timestamp = Date.parse(input);
  if (!Number.isFinite(timestamp)) return null;
  return timestamp;
}

export function normalizeMessageTimestamp(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

let cachedDefaultSystemPrompt: string | null = null;

export const getDefaultSystemPrompt = (): string => {
  if (cachedDefaultSystemPrompt !== null) {
    return cachedDefaultSystemPrompt;
  }
  try {
    const promptPath = path.join(app.getAppPath(), 'resources', 'SYSTEM_PROMPT.md');
    cachedDefaultSystemPrompt = fs.readFileSync(promptPath, 'utf-8');
  } catch {
    cachedDefaultSystemPrompt = '';
  }
  return cachedDefaultSystemPrompt;
};

export interface CoworkMessageRow {
  id: string;
  type: string;
  content: string;
  metadata: string | null;
  created_at: number;
  sequence: number | null;
}

/** Shared row mapping; corrupt metadata is discarded rather than failing the read. */
export const mapCoworkMessageRow = (row: CoworkMessageRow, sessionId: string): CoworkMessage => {
  let metadata: Record<string, unknown> | undefined;
  if (row.metadata) {
    try {
      metadata = JSON.parse(row.metadata);
    } catch {
      console.warn(
        `[CoworkStore] corrupt metadata detected for message ${row.id} in session ${sessionId}, discarding metadata`,
      );
      metadata = undefined;
    }
  }
  return {
    id: row.id,
    type: row.type as CoworkMessageType,
    content: row.content,
    timestamp: row.created_at,
    ...(row.sequence != null ? { sequence: row.sequence } : {}),
    metadata,
  };
};
