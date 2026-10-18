/**
 * Artifact ledger IPC contract (channel + args + result), single source of
 * truth for `registerArtifactIpc`, the `artifacts` preload namespace, and the
 * renderer `ArtifactsApi` types. The `artifact:upsert` push stays hand-wired.
 */
import { z } from 'zod';

import { defineIpcContract } from './contract';
import { ArtifactIpc } from './channels';
import { CoworkArtifactRole, CoworkArtifactSource } from '../cowork/artifacts';

const ArtifactTypeSchema = z.enum([
  'html',
  'svg',
  'image',
  'mermaid',
  'code',
  'markdown',
  'text',
  'document',
  'model',
  'unsupported',
]);

/** `CoworkPersistedArtifact` ledger row (`src/shared/cowork/artifacts.ts`). */
const CoworkPersistedArtifactSchema = z.object({
  id: z.string(),
  messageId: z.string(),
  toolCallId: z.string().nullable().optional(),
  runId: z.string().nullable().optional(),
  type: ArtifactTypeSchema,
  title: z.string(),
  content: z.string(),
  language: z.string().optional(),
  fileName: z.string().optional(),
  filePath: z.string().optional(),
  source: z.enum([CoworkArtifactSource.CodeBlock, CoworkArtifactSource.Tool]),
  role: z.enum([CoworkArtifactRole.Intermediate, CoworkArtifactRole.Deliverable]),
  declared: z.boolean(),
  createdAt: z.number(),
});

export const artifactsContract = defineIpcContract({
  list: {
    channel: ArtifactIpc.List,
    args: z.tuple([z.string()]),
    result: z.object({
      success: z.boolean(),
      artifacts: z.array(CoworkPersistedArtifactSchema).optional(),
      error: z.string().optional(),
    }),
  },
});
