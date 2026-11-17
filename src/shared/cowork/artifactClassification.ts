import { CoworkArtifactRole, type CoworkArtifactType } from './artifacts';

/** File types that represent user-facing deliverables (documents, web pages,
 * visuals, 3D models) rather than helper source files, plain logs, or
 * unsupported binary inputs. */
const DELIVERABLE_ARTIFACT_TYPES: ReadonlySet<CoworkArtifactType> = new Set([
  'html',
  'svg',
  'mermaid',
  'image',
  'markdown',
  'document',
  'model',
]);

export function getRecordedArtifactClassification(
  type: CoworkArtifactType,
  isInternalState: boolean,
): { role: CoworkArtifactRole; declared: boolean } {
  if (!isInternalState && DELIVERABLE_ARTIFACT_TYPES.has(type)) {
    return { role: CoworkArtifactRole.Deliverable, declared: true };
  }
  return { role: CoworkArtifactRole.Intermediate, declared: false };
}

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
  gltf: 'model',
  glb: 'model',
  ply: 'model',
  '3mf': 'model',
  dxf: 'document',
  // BREP CAD formats have no in-app mesh loader yet.
  step: 'unsupported',
  stp: 'unsupported',
  iges: 'unsupported',
  igs: 'unsupported',
};

export const getInlineArtifactRole = (explicit: boolean): CoworkArtifactRole =>
  explicit ? CoworkArtifactRole.Deliverable : CoworkArtifactRole.Intermediate;

export const getInlineArtifactLanguage = (
  type: CoworkArtifactType,
  language: string,
): string | undefined =>
  type === 'code' || language === 'csv' || language === 'tsv' ? language : undefined;
