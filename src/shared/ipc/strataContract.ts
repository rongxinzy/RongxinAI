import { z } from 'zod';

import {
  StrataEngineKind,
  StrataFamilyId,
  StrataInstallPhase,
  StrataIpcChannel,
} from '../strata/constants';
import { StrataServiceStatus } from '../strata/types';

const StatusSnapshotSchema = z.object({
  status: z.enum(Object.values(StrataServiceStatus)),
  checkedAt: z.string(),
  port: z.number().optional(),
  baseUrl: z.string().optional(),
  activeModelId: z.string().optional(),
  activeLaunchId: z.string().optional(),
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
  marketplaceVariants: z
    .array(
      z.object({
        label: z.string(),
        launchId: z.string(),
        files: z.array(
          z.object({
            repoId: z.string(),
            revision: z.string(),
            path: z.string(),
            bytes: z.number(),
            sha256: z.string(),
            shared: z.literal(true).optional(),
          }),
        ),
      }),
    )
    .optional(),
});

const ServiceConfigSchema = z.object({
  port: z.string().optional(),
});

const VariantRefSchema = z.object({
  catalogId: z.string().max(128),
  launchId: z.string().max(128),
});
const InstallStateSchema = z.object({
  installed: z.array(VariantRefSchema),
  job: VariantRefSchema.extend({
    phase: z.enum(Object.values(StrataInstallPhase)),
    completed: z.number(),
    total: z.number(),
    error: z.string().optional(),
  }).optional(),
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
    args: z.tuple([VariantRefSchema.partial({ launchId: true })]),
    result: StatusSnapshotSchema,
  },
  stop: {
    channel: StrataIpcChannel.Stop,
    args: z.tuple([]),
    result: StatusSnapshotSchema,
  },
  install: {
    channel: StrataIpcChannel.Install,
    args: z.tuple([VariantRefSchema]),
    result: z.void(),
  },
  installState: {
    channel: StrataIpcChannel.InstallState,
    args: z.tuple([]),
    result: InstallStateSchema,
  },
  cancelInstall: {
    channel: StrataIpcChannel.CancelInstall,
    args: z.tuple([VariantRefSchema]),
    result: z.void(),
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
