import * as fs from 'fs';
import { isIP } from 'node:net';

import { CoreSkillId } from '../../../shared/skills/constants';

export const ShortcutWorkflowKind = {
  Ppt: 'ppt',
  DeepResearch: 'deep-research',
  Docs: 'docs',
  Website: 'website',
  Sheets: 'sheets',
} as const;
export type ShortcutWorkflowKind = (typeof ShortcutWorkflowKind)[keyof typeof ShortcutWorkflowKind];

export type WorkflowFileRole = 'deliverable' | 'validation' | 'preview';

export interface WorkflowFile {
  path: string;
  role: WorkflowFileRole;
  verifiedAt: string;
}

export interface WorkflowState {
  version: 1;
  sessionId: string;
  kind: ShortcutWorkflowKind;
  task: string;
  status: 'running' | 'completion_requested' | 'completed' | 'needs_attention';
  iteration: number;
  staleCount: number;
  completionReason?: string;
  files: WorkflowFile[];
  researchAngles: string[];
  sources: string[];
  researcherRuns: number;
  updatedAt: string;
}

export const resolveShortcutWorkflowKind = (
  skillIds: string[] | undefined,
): ShortcutWorkflowKind | null => {
  if (!skillIds) return null;
  if (skillIds.includes(CoreSkillId.Pptx)) return ShortcutWorkflowKind.Ppt;
  if (skillIds.includes(CoreSkillId.DeepResearch)) return ShortcutWorkflowKind.DeepResearch;
  if (skillIds.includes(CoreSkillId.Docx)) return ShortcutWorkflowKind.Docs;
  if (skillIds.includes(CoreSkillId.FrontendDesign)) return ShortcutWorkflowKind.Website;
  if (skillIds.includes(CoreSkillId.Xlsx)) return ShortcutWorkflowKind.Sheets;
  return null;
};

export const workflowLabel = (kind: ShortcutWorkflowKind): string =>
  ({
    [ShortcutWorkflowKind.Ppt]: 'PPT presentation',
    [ShortcutWorkflowKind.DeepResearch]: 'deep-research report',
    [ShortcutWorkflowKind.Docs]: 'Word document',
    [ShortcutWorkflowKind.Website]: 'website',
    [ShortcutWorkflowKind.Sheets]: 'spreadsheet',
  })[kind];

export const expectedExtensions = (kind: ShortcutWorkflowKind): string[] =>
  ({
    [ShortcutWorkflowKind.Ppt]: ['.pptx'],
    [ShortcutWorkflowKind.Docs]: ['.docx'],
    [ShortcutWorkflowKind.Website]: ['.html', '.htm'],
    [ShortcutWorkflowKind.Sheets]: ['.xlsx', '.xlsm', '.csv', '.tsv'],
    [ShortcutWorkflowKind.DeepResearch]: [],
  })[kind];

export const isOfficeZip = (filePath: string): boolean => {
  const header = Buffer.alloc(4);
  const fd = fs.openSync(filePath, 'r');
  try {
    fs.readSync(fd, header, 0, header.length, 0);
  } finally {
    fs.closeSync(fd);
  }
  return header.subarray(0, 2).toString() === 'PK';
};

export const isSafePublicUrl = (rawUrl: string): boolean => {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password)
    return false;
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) return false;
  const ipVersion = isIP(hostname);
  if (ipVersion === 6)
    return (
      hostname !== '::' &&
      hostname !== '::1' &&
      !hostname.startsWith('fc') &&
      !hostname.startsWith('fd') &&
      !hostname.startsWith('fe8') &&
      !hostname.startsWith('fe9') &&
      !hostname.startsWith('fea') &&
      !hostname.startsWith('feb') &&
      !hostname.startsWith('::ffff:')
    );
  if (ipVersion !== 4) return true;
  const [first, second] = hostname.split('.').map(Number);
  return !(
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 198 && (second === 18 || second === 19)) ||
    first >= 224
  );
};
