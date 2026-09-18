import { CoworkArtifactRole, type CoworkArtifactType } from './artifacts';

export const ArtifactTypeByLanguage: Readonly<Record<string, CoworkArtifactType>> = {
  html: 'html',
  svg: 'svg',
  mermaid: 'mermaid',
  jsx: 'code',
  tsx: 'code',
  code: 'code',
  document: 'document',
  image: 'image',
  markdown: 'markdown',
  md: 'markdown',
  csv: 'document',
  tsv: 'document',
  text: 'text',
  txt: 'text',
  plaintext: 'text',
  model: 'model',
  stl: 'model',
  obj: 'model',
  step: 'model',
  iges: 'model',
};

export const getInlineArtifactRole = (explicit: boolean): CoworkArtifactRole =>
  explicit ? CoworkArtifactRole.Deliverable : CoworkArtifactRole.Intermediate;

export const getInlineArtifactLanguage = (
  type: CoworkArtifactType,
  language: string,
): string | undefined =>
  type === 'code' || language === 'csv' || language === 'tsv' ? language : undefined;
