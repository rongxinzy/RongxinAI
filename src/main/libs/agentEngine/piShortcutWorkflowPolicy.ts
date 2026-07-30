import * as fs from 'fs';
import { isIP } from 'node:net';
import JSZip from 'jszip';

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
  if (skillIds.includes(CoreSkillId.PresentationStudio)) return ShortcutWorkflowKind.Ppt;
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
    // Evidence collection alone is not a user-facing result. Deep research
    // must leave a durable, reviewable report in the selected workspace.
    [ShortcutWorkflowKind.DeepResearch]: ['.md'],
  })[kind];

export const validationExtensions = ['.md', '.txt', '.json'];
export const previewExtensions = ['.png', '.jpg', '.jpeg'];

export const requiresRenderedPreview = (kind: ShortcutWorkflowKind): boolean =>
  kind !== ShortcutWorkflowKind.DeepResearch;

/** Reject renamed text files before treating a claimed screenshot as visual QA evidence. */
export const isValidRasterPreview = (filePath: string): boolean => {
  try {
    const bytes = fs.readFileSync(filePath);
    if (bytes.length < 24) return false;
    const isPng =
      bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) &&
      bytes.subarray(12, 16).toString('ascii') === 'IHDR';
    if (isPng) return bytes.readUInt32BE(16) > 0 && bytes.readUInt32BE(20) > 0;

    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return false;
    for (let offset = 2; offset + 8 < bytes.length; ) {
      if (bytes[offset] !== 0xff) return false;
      while (bytes[offset] === 0xff) offset += 1;
      const marker = bytes[offset++];
      if (marker === 0xd9 || marker === 0xda) return false;
      const segmentLength = bytes.readUInt16BE(offset);
      if (segmentLength < 2 || offset + segmentLength > bytes.length) return false;
      const isStartOfFrame =
        (marker >= 0xc0 && marker <= 0xc3) ||
        (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) ||
        (marker >= 0xcd && marker <= 0xcf);
      if (isStartOfFrame)
        return bytes.readUInt16BE(offset + 3) > 0 && bytes.readUInt16BE(offset + 5) > 0;
      offset += segmentLength;
    }
    return false;
  } catch {
    return false;
  }
};

const ResearchTrackingParameters = new Set([
  'dclid',
  'fbclid',
  'gclid',
  'mc_cid',
  'mc_eid',
  'msclkid',
]);

export const normalizeResearchSourceUrl = (source: URL): string => {
  const normalized = new URL(source);
  normalized.hash = '';
  for (const key of [...normalized.searchParams.keys()]) {
    if (key.toLowerCase().startsWith('utm_') || ResearchTrackingParameters.has(key.toLowerCase())) {
      normalized.searchParams.delete(key);
    }
  }
  normalized.searchParams.sort();
  return normalized.toString();
};

export const collectShortcutCompletionFailures = (state: WorkflowState): string[] => {
  const failures: string[] = [];
  if (!state.files.some(file => file.role === 'deliverable'))
    failures.push('no verified deliverable file is recorded');
  if (!state.files.some(file => file.role === 'validation'))
    failures.push('no verification report is recorded');
  if (requiresRenderedPreview(state.kind) && !state.files.some(file => file.role === 'preview'))
    failures.push('no inspected rendered preview is recorded');

  if (state.kind === ShortcutWorkflowKind.DeepResearch) {
    if (state.researchAngles.length < 3)
      failures.push('fewer than three research angles are recorded');
    if (state.researcherRuns < 3)
      failures.push('fewer than three researcher delegations completed successfully');
    if (state.sources.length < 6) failures.push('fewer than six reachable sources are recorded');
    const sourceHosts = new Set(
      state.sources.map(source => {
        try {
          return new URL(source).hostname;
        } catch {
          return '';
        }
      }),
    );
    sourceHosts.delete('');
    if (sourceHosts.size < 3) failures.push('sources cover fewer than three distinct hosts');
    return failures;
  }
  return failures;
};

const officeRequiredEntries = (kind: ShortcutWorkflowKind): string[] => {
  if (kind === ShortcutWorkflowKind.Ppt) return ['[Content_Types].xml', 'ppt/presentation.xml'];
  if (kind === ShortcutWorkflowKind.Docs) return ['[Content_Types].xml', 'word/document.xml'];
  if (kind === ShortcutWorkflowKind.Sheets) return ['[Content_Types].xml', 'xl/workbook.xml'];
  return [];
};

export const isValidOfficePackage = async (
  filePath: string,
  kind: ShortcutWorkflowKind,
): Promise<boolean> => {
  try {
    const archive = await JSZip.loadAsync(fs.readFileSync(filePath), { checkCRC32: true });
    const names = Object.keys(archive.files);
    if (!officeRequiredEntries(kind).every(entry => archive.file(entry))) return false;
    const readXml = async (entry: string): Promise<string> =>
      (await archive.file(entry)?.async('text')) || '';
    if (
      kind === ShortcutWorkflowKind.Ppt &&
      !names.some(name => /^ppt\/slides\/slide\d+\.xml$/i.test(name))
    )
      return false;
    if (
      kind === ShortcutWorkflowKind.Sheets &&
      !names.some(name => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name))
    )
      return false;
    if (kind === ShortcutWorkflowKind.Docs) {
      const document = await readXml('word/document.xml');
      if (!/<w:document\b[^>]*xmlns:w=/i.test(document) || !/<w:body\b/i.test(document))
        return false;
    }
    if (kind === ShortcutWorkflowKind.Sheets) {
      const workbook = await readXml('xl/workbook.xml');
      const sheets = names.filter(name => /^xl\/worksheets\/sheet\d+\.xml$/i.test(name));
      if (!/<workbook\b[^>]*xmlns=/i.test(workbook)) return false;
      for (const sheet of sheets) {
        if (!/<worksheet\b[^>]*xmlns=/i.test(await readXml(sheet))) return false;
      }
    }
    return true;
  } catch {
    return false;
  }
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
