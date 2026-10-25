import { z } from 'zod';

import { StrataIpcChannel, StrataFamilyId, StrataEngineKind } from '../strata/constants';
import { StrataServiceStatus } from '../strata/types';

const StatusSnapshotSchema = z.object({
  status: z.enum(Object.values(StrataServiceStatus)),
  checkedAt: z.string(),
  port: z.number().optional(),
  baseUrl: z.string().optional(),
  activeModelId: z.string().optional(),
  managedByApp: z.boolean().optional(),
  error: z.string().optional(),
  bundled: z.boolean().optional(),
});

const CatalogEntrySchema = z.object({
  id: z.string(),
  family: z.enum(Object.values(StrataFamilyId)),
  engine: z.enum(Object.values(StrataEngineKind)),
  displayName: z.string(),
  modelLaunchId: z.string(),
  hardware: z.object({
    minSystemRamGb: z.number(),
    minVramGb: z.number(),
    minDiskGb: z.number(),
    docNoteKey: z.string(),
  }),
  docUrl: z.string(),
});

const ServiceConfigSchema = z.object({
  port: z.string().optional(),
});

export const strataContract = {
  isBundled: {
    channel: StrataIpcChannel.IsBundled,
    args: z.tuple([]),
    result: z.boolean(),
  },
  catalog: {
    channel: StrataIpcChannel.Catalog,
    args: z.tuple([]),
    result: z.array(CatalogEntrySchema),
  },
  status: {
    channel: StrataIpcChannel.Status,
    args: z.tuple([]),
    result: StatusSnapshotSchema,
  },
  start: {
    channel: StrataIpcChannel.Start,
    args: z.tuple([z.object({ catalogId: z.string() })]),
    result: StatusSnapshotSchema,
  },
  stop: {
    channel: StrataIpcChannel.Stop,
    args: z.tuple([]),
    result: StatusSnapshotSchema,
  },
  getServiceConfig: {
    channel: StrataIpcChannel.ServiceConfigGet,
    args: z.tuple([]),
    result: ServiceConfigSchema,
  },
  setServiceConfig: {
    channel: StrataIpcChannel.ServiceConfigSet,
    args: z.tuple([ServiceConfigSchema]),
    result: ServiceConfigSchema,
  },
} as const;
