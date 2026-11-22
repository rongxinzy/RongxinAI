import { boundWorkerInput } from './boundedWorkerInput';
import {
  boundToolResult,
  type TextWorkerInput,
  type TextWorkerOutput,
} from './textWorkerOperations';
import { CoworkRunPolicy } from '../../shared/cowork/runState';
import type { LlamaCppModel } from '../../shared/llamacpp';
import { isPathInside } from '../pathContainment';
import { LOCAL_GGUF_CATALOG_LIMIT } from '../libs/llamacppModelCatalogLimits';
import type { GgufPlacementMetadata } from '../libs/ggufMetadata';
import {
  ModelCatalogUpdateLimit,
  type CatalogUpdate,
  type VerifyModelCatalogUpdateInput,
} from '../libs/modelCatalogUpdateTypes';
import { SkillCatalogLimit } from '../skills/constants';
import type { SkillCatalogInput } from '../skills/skillRecords';
import type { SkillRecord } from '../skills/types';
import type { McpMarketplaceAssets } from '../mcpMarketplace';
import { PresetCatalogLimit, type PresetExpertCatalogEntry } from '../presetExpertCatalog';
import {
  isPathSegment,
  PRESET_EXPERTS_DIR,
  PresetMemberLimit,
  type BundledPresetExpertSnapshot,
  type BundledPresetMember,
  type readPresetMemberProfiles,
} from '../presetExpertSnapshot';
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import {
  ArtifactWorkerLimit,
  ArtifactWorkerTask,
  CoworkImageLimit,
} from './artifactWorkerConstants';
import type {
  ArtifactWorkerInput,
  DecodedCoworkImage,
  WorkspaceContentInspection,
} from './artifactWorkerTypes';
import { COMPANION_MAX_ATTACHMENTS } from '../../shared/companion/attachments';
import {
  CompanionImageLimit,
  COMPANION_IMAGE_MIME_TYPES,
  type CompanionImageSource,
  type CompanionPreparedImage,
} from '../../shared/companion/images';

type Result =
  | WorkspaceContentInspection
  | TextWorkerOutput
  | CompanionPreparedImage[]
  | DecodedCoworkImage
  | LlamaCppModel[]
  | SkillRecord[]
  | McpMarketplaceAssets
  | string[]
  | PresetExpertCatalogEntry[]
  | BundledPresetMember[]
  | BundledPresetExpertSnapshot
  | GgufPlacementMetadata
  | CatalogUpdate
  | string
  | null;
type Response = {
  text?: TextWorkerOutput;
  content?: WorkspaceContentInspection;
  images?: CompanionPreparedImage[];
  decodedImage?: DecodedCoworkImage | null;
  imageBase64?: string;
  models?: LlamaCppModel[];
  skills?: SkillRecord[];
  marketplace?: McpMarketplaceAssets;
  directories?: string[];
  experts?: PresetExpertCatalogEntry[];
  members?: BundledPresetMember[];
  expert?: BundledPresetExpertSnapshot | null;
  placement?: GgufPlacementMetadata;
  catalogUpdate?: CatalogUpdate;
  error?: string;
  runMs: number;
};
type Job = {
  task: ArtifactWorkerInput;
  queuedAt: number;
  resolve: (result: Result) => void;
  reject: (error: Error) => void;
  signal?: AbortSignal;
  onAbort: () => void;
};
type Slot = { worker: Worker; job?: Job; startedAt?: number; timer?: NodeJS.Timeout };

const isPresetRoot = (root: string): boolean =>
  path.isAbsolute(root) && root.length <= SkillCatalogLimit.PathCharacters && !root.includes('\0');

export class WorkbenchArtifactWorkerPool {
  private readonly slots: Slot[] = [];
  private readonly queue: Job[] = [];

  readPresetCatalog(skillsRoot: string, signal?: AbortSignal): Promise<PresetExpertCatalogEntry[]> {
    if (!isPresetRoot(skillsRoot)) {
      return Promise.reject(new Error('Invalid bundled expert catalog source.'));
    }
    return this.enqueue(
      { kind: ArtifactWorkerTask.ReadPresetCatalog, input: { skillsRoot } },
      signal,
    ) as Promise<PresetExpertCatalogEntry[]>;
  }

  readPresetMembers(
    input: Parameters<typeof readPresetMemberProfiles>[0],
    signal?: AbortSignal,
  ): Promise<BundledPresetMember[]> {
    if (
      !isPathSegment(input.presetId) ||
      input.presetId.length > 255 ||
      ![input.skillsRoot, input.piAgentsDir].every(isPresetRoot)
    ) {
      return Promise.reject(new Error('Invalid team member source.'));
    }
    return this.enqueue({ kind: ArtifactWorkerTask.ReadPresetMembers, input }, signal) as Promise<
      BundledPresetMember[]
    >;
  }

  readPresetExpert(input: {
    skillsRoot: string;
    presetId: string;
    agentId: string;
  }): Promise<BundledPresetExpertSnapshot | null> {
    if (
      !isPresetRoot(input.skillsRoot) ||
      ![input.presetId, input.agentId].every(id => id.length <= 255 && isPathSegment(id))
    ) {
      return Promise.resolve(null);
    }
    return this.enqueue({
      kind: ArtifactWorkerTask.ReadPresetExpert,
      input,
    }) as Promise<BundledPresetExpertSnapshot | null>;
  }

  constructor(private readonly workerPath = path.join(__dirname, 'artifactWorker.js')) {}

  transform(input: TextWorkerInput, signal?: AbortSignal): Promise<TextWorkerOutput> {
    try {
      return this.enqueue(
        {
          kind: ArtifactWorkerTask.TransformText,
          input: { ...input, result: boundToolResult(input.result) },
        },
        signal,
      ) as Promise<TextWorkerOutput>;
    } catch (error) {
      return Promise.reject(error);
    }
  }

  inspectContent(bytes: ArrayBuffer, signal?: AbortSignal): Promise<WorkspaceContentInspection> {
    if (bytes.byteLength > ArtifactWorkerLimit.WorkspaceContentBytes) {
      return Promise.reject(new Error('Workspace content input limit exceeded.'));
    }
    return this.enqueue(
      { kind: ArtifactWorkerTask.InspectWorkspaceContent, input: { bytes } },
      signal,
    ).then(result => result as WorkspaceContentInspection);
  }

  decodeCoworkImage(data: string, signal?: AbortSignal): Promise<DecodedCoworkImage | null> {
    if (data.length > CoworkImageLimit.Base64Characters + CoworkImageLimit.DataUrlHeaderCharacters)
      return Promise.resolve(null);
    return this.enqueue(
      { kind: ArtifactWorkerTask.DecodeCoworkImage, input: { data } },
      signal,
    ) as Promise<DecodedCoworkImage | null>;
  }

  readCoworkImage(filePath: string, signal?: AbortSignal): Promise<string> {
    return this.enqueue(
      { kind: ArtifactWorkerTask.ReadCoworkImage, input: { filePath } },
      signal,
    ) as Promise<string>;
  }

  scanLocalModels(modelsDir: string, signal?: AbortSignal): Promise<LlamaCppModel[]> {
    const root = path.resolve(modelsDir);
    if (root.length > LOCAL_GGUF_CATALOG_LIMIT.PathCharacters || root.includes('\0')) {
      return Promise.reject(new Error('Invalid local model directory.'));
    }
    return this.enqueue(
      { kind: ArtifactWorkerTask.ScanLocalModels, input: { modelsDir: root } },
      signal,
    ) as Promise<LlamaCppModel[]>;
  }

  verifyModelCatalog(
    input: VerifyModelCatalogUpdateInput,
    signal?: AbortSignal,
  ): Promise<CatalogUpdate> {
    if (input.bytes.byteLength > ModelCatalogUpdateLimit.Bytes) {
      return Promise.reject(new Error('Model catalog update exceeds the size limit'));
    }
    return this.enqueue(
      { kind: ArtifactWorkerTask.VerifyModelCatalog, input },
      signal,
    ) as Promise<CatalogUpdate>;
  }

  readSkillCatalog(input: SkillCatalogInput, signal?: AbortSignal): Promise<SkillRecord[]> {
    const roots = [input.primaryRoot, input.bundledRoot, ...input.roots];
    const state = Object.values(input.state);
    const stateCharacters = state.reduce(
      (sum, entry) => sum + (entry?.iconUrl?.length ?? 0) + (entry?.displayName?.length ?? 0),
      0,
    );
    if (
      input.roots.length > SkillCatalogLimit.Roots ||
      roots.some(
        root =>
          !path.isAbsolute(root) ||
          root.length > SkillCatalogLimit.PathCharacters ||
          root.includes('\0'),
      ) ||
      state.length > SkillCatalogLimit.Candidates ||
      stateCharacters > SkillCatalogLimit.ResultBytes
    ) {
      return Promise.reject(new Error('Skill catalog input exceeds the supported limits'));
    }
    return this.enqueue({ kind: ArtifactWorkerTask.ReadSkillCatalog, input }, signal) as Promise<
      SkillRecord[]
    >;
  }

  findSkillSourceDirs(source: string, signal?: AbortSignal): Promise<string[]> {
    const root = path.resolve(source);
    if (!isPresetRoot(root)) return Promise.reject(new Error('Invalid Skill source directory.'));
    return this.enqueue(
      { kind: ArtifactWorkerTask.FindSkillSourceDirs, input: { source: root } },
      signal,
    ) as Promise<string[]>;
  }

  readMcpMarketplace(roots: string[], signal?: AbortSignal): Promise<McpMarketplaceAssets> {
    if (roots.length === 0 || roots.length > 3 || !roots.every(isPresetRoot)) {
      return Promise.reject(new Error('Invalid bundled MCP marketplace roots.'));
    }
    return this.enqueue(
      { kind: ArtifactWorkerTask.ReadMcpMarketplace, input: { roots } },
      signal,
    ) as Promise<McpMarketplaceAssets>;
  }

  readGgufPlacement(
    filePath: string,
    cacheTypeK?: string,
    cacheTypeV?: string,
    signal?: AbortSignal,
  ): Promise<GgufPlacementMetadata> {
    if (
      !path.isAbsolute(filePath) ||
      filePath.length > LOCAL_GGUF_CATALOG_LIMIT.PathCharacters ||
      filePath.includes('\0') ||
      (cacheTypeK?.length ?? 0) > 32 ||
      (cacheTypeV?.length ?? 0) > 32
    ) {
      return Promise.reject(new Error('Invalid GGUF metadata request.'));
    }
    return this.enqueue(
      { kind: ArtifactWorkerTask.ReadGgufPlacement, input: { filePath, cacheTypeK, cacheTypeV } },
      signal,
    ) as Promise<GgufPlacementMetadata>;
  }

  prepareImages(
    sources: CompanionImageSource[],
    signal?: AbortSignal,
  ): Promise<CompanionPreparedImage[]> {
    if (
      !sources.length ||
      sources.length > COMPANION_MAX_ATTACHMENTS ||
      sources.some(source => !path.isAbsolute(source.path))
    )
      return Promise.reject(new Error('Invalid companion image selection.'));
    try {
      const bounded = boundWorkerInput(sources, {
        nodes: 128,
        depth: 4,
        characters: 128 * 1024,
      }) as CompanionImageSource[];
      return this.enqueue(
        { kind: ArtifactWorkerTask.PrepareCompanionImages, input: { sources: bounded } },
        signal,
      ) as Promise<CompanionPreparedImage[]>;
    } catch (error) {
      return Promise.reject(error);
    }
  }

  private enqueue(task: ArtifactWorkerInput, signal?: AbortSignal): Promise<Result> {
    if (signal?.aborted) return Promise.reject(new Error('Artifact worker task cancelled.'));
    if (this.queue.length >= ArtifactWorkerLimit.Queue) {
      return Promise.reject(new Error('Artifact worker queue is full.'));
    }
    return new Promise((resolve, reject) => {
      const job: Job = {
        task,
        signal,
        resolve,
        reject,
        queuedAt: performance.now(),
        onAbort: () => {
          const slot = this.slots.find(candidate => candidate.job === job);
          if (slot) this.finish(slot, new Error('Artifact worker task cancelled.'), true);
          else {
            const index = this.queue.indexOf(job);
            if (index >= 0) this.queue.splice(index, 1);
            signal?.removeEventListener('abort', job.onAbort);
            reject(new Error('Artifact worker task cancelled.'));
          }
        },
      };
      signal?.addEventListener('abort', job.onAbort, { once: true });
      this.queue.push(job);
      this.dispatch();
    });
  }

  dispose(): void {
    for (const job of this.queue.splice(0)) {
      job.signal?.removeEventListener('abort', job.onAbort);
      job.reject(new Error('Artifact collection pool closed.'));
    }
    for (const slot of [...this.slots]) {
      this.finish(slot, new Error('Artifact collection pool closed.'), true);
    }
  }

  private dispatch(): void {
    while (this.queue.length) {
      let slot = this.slots.find(candidate => !candidate.job);
      if (!slot && this.slots.length < ArtifactWorkerLimit.Workers) {
        const worker = new Worker(this.workerPath);
        slot = { worker };
        const created = slot;
        worker.on('message', (response: Response) => {
          const job = created.job;
          if (!job) return;
          console.debug(
            `[WorkbenchArtifacts] completed ${job.task.kind} after ${Math.round(created.startedAt! - job.queuedAt)} ms queued and ${Math.round(response.runMs)} ms running`,
          );
          if (job.task.kind === ArtifactWorkerTask.TransformText) {
            const text = response.text;
            if (
              response.error ||
              !text ||
              typeof text.content !== 'string' ||
              text.content.length > CoworkRunPolicy.MaximumContentCharacters ||
              !Number.isSafeInteger(text.offset) ||
              text.offset < 0
            )
              this.finish(created, new Error(response.error || 'Invalid text worker result.'));
            else this.finish(created, undefined, false, text);
          } else if (job.task.kind === ArtifactWorkerTask.PrepareCompanionImages) {
            const images = response.images;
            const sources = job.task.input.sources;
            if (
              response.error ||
              !Array.isArray(images) ||
              images.length !== sources.length ||
              images.some(
                (image, index) =>
                  image.id !== sources[index].id ||
                  image.name !== sources[index].name ||
                  typeof image.data !== 'string' ||
                  image.data.length > CompanionImageLimit.EncodedBytes ||
                  !COMPANION_IMAGE_MIME_TYPES.includes(image.mimeType),
              ) ||
              images.reduce((sum, image) => sum + image.data.length, 0) >
                CompanionImageLimit.BatchEncodedBytes
            ) {
              this.finish(
                created,
                new Error(response.error || 'Invalid companion image worker result.'),
              );
            } else {
              // Photon retains peak WASM memory. Recycle this slot after each
              // image batch instead of retaining a photo-sized heap while idle.
              this.finish(created, undefined, true, images);
            }
          } else if (job.task.kind === ArtifactWorkerTask.DecodeCoworkImage) {
            const image = response.decodedImage;
            if (
              response.error ||
              (image !== null &&
                (!(image?.bytes instanceof ArrayBuffer) ||
                  image.bytes.byteLength === 0 ||
                  image.bytes.byteLength > CoworkImageLimit.Bytes ||
                  !/^[a-f0-9]{32}$/.test(image.hash)))
            ) {
              this.finish(
                created,
                new Error(response.error || 'Invalid Cowork image worker result.'),
              );
            } else this.finish(created, undefined, false, image);
          } else if (job.task.kind === ArtifactWorkerTask.ReadCoworkImage) {
            const image = response.imageBase64;
            if (
              response.error ||
              typeof image !== 'string' ||
              image.length > CoworkImageLimit.Base64Characters
            ) {
              this.finish(
                created,
                new Error(response.error || 'Invalid Cowork image read result.'),
              );
            } else this.finish(created, undefined, false, image);
          } else if (job.task.kind === ArtifactWorkerTask.ScanLocalModels) {
            const models = response.models;
            const { modelsDir } = job.task.input;
            if (
              response.error ||
              !Array.isArray(models) ||
              models.length > LOCAL_GGUF_CATALOG_LIMIT.Models ||
              models.some(
                model =>
                  typeof model?.path !== 'string' ||
                  !path.isAbsolute(model.path) ||
                  !isPathInside(model.path, modelsDir) ||
                  typeof model.name !== 'string' ||
                  !Number.isSafeInteger(model.size) ||
                  (model.size ?? -1) < 0,
              )
            ) {
              this.finish(
                created,
                new Error(response.error || 'Invalid local model catalog result.'),
              );
            } else this.finish(created, undefined, false, models);
          } else if (job.task.kind === ArtifactWorkerTask.VerifyModelCatalog) {
            const { catalogUpdate, error } = response;
            if (
              error ||
              !catalogUpdate ||
              catalogUpdate.baseRevision !== job.task.input.baseRevision ||
              catalogUpdate.revision !== job.task.input.revision ||
              !Number.isFinite(Date.parse(catalogUpdate.updatedAt)) ||
              !Array.isArray(catalogUpdate.upserts) ||
              catalogUpdate.upserts.length > ModelCatalogUpdateLimit.Records ||
              !Array.isArray(catalogUpdate.deletes) ||
              catalogUpdate.deletes.length > ModelCatalogUpdateLimit.Records
            ) {
              this.finish(created, new Error(error || 'Invalid model catalog worker result.'));
            } else this.finish(created, undefined, false, catalogUpdate);
          } else if (job.task.kind === ArtifactWorkerTask.ReadSkillCatalog) {
            const { skills, error } = response;
            const { roots, primaryRoot } = job.task.input;
            const catalogRoots = [primaryRoot, ...roots];
            if (
              error ||
              !Array.isArray(skills) ||
              skills.length > SkillCatalogLimit.Candidates ||
              skills.some(
                skill =>
                  typeof skill?.skillPath !== 'string' ||
                  !path.isAbsolute(skill.skillPath) ||
                  !catalogRoots.some(root => isPathInside(skill.skillPath, root)) ||
                  typeof skill.id !== 'string' ||
                  typeof skill.name !== 'string' ||
                  typeof skill.enabled !== 'boolean',
              )
            ) {
              this.finish(created, new Error(error || 'Invalid Skill catalog result.'));
            } else this.finish(created, undefined, false, skills);
          } else if (job.task.kind === ArtifactWorkerTask.ReadMcpMarketplace) {
            const { marketplace, error } = response;
            if (
              error ||
              !Array.isArray(marketplace?.catalog?.categories) ||
              !Array.isArray(marketplace.catalog.servers) ||
              !(marketplace.icons instanceof Map) ||
              marketplace.icons.size > marketplace.catalog.servers.length
            ) {
              this.finish(created, new Error(error || 'Invalid MCP marketplace result.'));
            } else this.finish(created, undefined, false, marketplace);
          } else if (job.task.kind === ArtifactWorkerTask.FindSkillSourceDirs) {
            const { directories, error } = response;
            const { source } = job.task.input;
            if (
              error ||
              !Array.isArray(directories) ||
              directories.length > SkillCatalogLimit.Candidates ||
              directories.some(
                dir => typeof dir !== 'string' || !isPresetRoot(dir) || !isPathInside(dir, source),
              )
            ) {
              this.finish(created, new Error(error || 'Invalid Skill source directory result.'));
            } else this.finish(created, undefined, false, directories);
          } else if (job.task.kind === ArtifactWorkerTask.ReadPresetCatalog) {
            const { experts, error } = response;
            const directory = path.join(job.task.input.skillsRoot, ...PRESET_EXPERTS_DIR);
            if (
              error ||
              !Array.isArray(experts) ||
              experts.length > PresetCatalogLimit.Entries ||
              experts.some(
                expert =>
                  typeof expert?.path !== 'string' ||
                  path.dirname(expert.path) !== directory ||
                  !isPathSegment(path.basename(expert.path)),
              )
            ) {
              this.finish(created, new Error(error || 'Invalid bundled expert catalog result.'));
            } else this.finish(created, undefined, false, experts);
          } else if (job.task.kind === ArtifactWorkerTask.ReadPresetMembers) {
            const { members, error } = response;
            if (
              error ||
              !Array.isArray(members) ||
              members.length > PresetMemberLimit.Members ||
              members.some(
                member =>
                  typeof member?.id !== 'string' ||
                  !isPathSegment(member.id) ||
                  typeof member.description !== 'string' ||
                  typeof member.systemPrompt !== 'string' ||
                  !member.systemPrompt,
              ) ||
              members.reduce(
                (size, member) =>
                  size + member.id.length + member.description.length + member.systemPrompt.length,
                0,
              ) > PresetMemberLimit.ResultCharacters
            ) {
              this.finish(created, new Error(error || 'Invalid team member worker result.'));
            } else this.finish(created, undefined, false, members);
          } else if (job.task.kind === ArtifactWorkerTask.ReadPresetExpert) {
            const { expert, error } = response;
            if (
              error ||
              (expert !== null &&
                (typeof expert?.promptSnapshot !== 'string' ||
                  expert.promptSnapshot.length > PresetMemberLimit.ResultCharacters ||
                  ![expert.skillIds, expert.mcpIds].every(
                    ids => Array.isArray(ids) && ids.every(id => typeof id === 'string'),
                  ) ||
                  !expert.capabilityPolicy ||
                  typeof expert.capabilityPolicy !== 'object' ||
                  Array.isArray(expert.capabilityPolicy)))
            ) {
              this.finish(created, new Error(error || 'Invalid expert preset worker result.'));
            } else this.finish(created, undefined, false, expert);
          } else if (job.task.kind === ArtifactWorkerTask.ReadGgufPlacement) {
            const placement = response.placement;
            if (
              response.error ||
              !placement ||
              [placement.blockCount, placement.kvBytesPerToken].some(
                value => value !== undefined && (!Number.isSafeInteger(value) || value < 0),
              )
            ) {
              this.finish(created, new Error(response.error || 'Invalid GGUF metadata result.'));
            } else this.finish(created, undefined, false, placement);
          } else {
            const content = response.content;
            if (
              response.error ||
              !content ||
              !/^[a-f0-9]{64}$/.test(content.sha256) ||
              typeof content.text !== 'string' ||
              typeof content.binary !== 'boolean' ||
              content.text.length > ArtifactWorkerLimit.WorkspaceContentBytes
            ) {
              this.finish(
                created,
                new Error(response.error || 'Invalid workspace content worker result.'),
              );
            } else {
              this.finish(created, undefined, false, content);
            }
          }
        });
        worker.on('error', error => this.finish(created, error, true));
        worker.on('exit', () => {
          if (this.slots.includes(created)) {
            this.finish(created, new Error('Artifact worker exited unexpectedly.'), true);
          }
        });
        this.slots.push(slot);
      }
      if (!slot) return;
      slot.job = this.queue.shift()!;
      slot.startedAt = performance.now();
      slot.worker.ref();
      slot.timer = setTimeout(
        () => this.finish(slot!, new Error('Artifact collection timed out.'), true),
        ArtifactWorkerLimit.TimeoutMs,
      );
      try {
        const task = slot.job.task;
        slot.worker.postMessage(
          task,
          task.kind === ArtifactWorkerTask.InspectWorkspaceContent ||
            task.kind === ArtifactWorkerTask.VerifyModelCatalog
            ? [task.input.bytes]
            : [],
        );
      } catch (error) {
        this.finish(slot, error instanceof Error ? error : new Error(String(error)), true);
      }
    }
  }

  private finish(slot: Slot, error?: Error, terminate = false, result?: Result): void {
    const job = slot.job;
    clearTimeout(slot.timer);
    slot.job = undefined;
    if (terminate) {
      const index = this.slots.indexOf(slot);
      if (index >= 0) this.slots.splice(index, 1);
      void slot.worker.terminate();
    } else slot.worker.unref();
    if (job) {
      job.signal?.removeEventListener('abort', job.onAbort);
      if (error) job.reject(error);
      else job.resolve(result!);
    }
    this.dispatch();
  }
}

const pool = new WorkbenchArtifactWorkerPool();
export const decodeCoworkImageAsync = (data: string, signal?: AbortSignal) =>
  pool.decodeCoworkImage(data, signal);

export const readCoworkImageAsync = (filePath: string, signal?: AbortSignal) =>
  pool.readCoworkImage(filePath, signal);

export const scanLocalModelsAsync = (modelsDir: string, signal?: AbortSignal) =>
  pool.scanLocalModels(modelsDir, signal);

export const verifyModelCatalogAsync = (
  input: VerifyModelCatalogUpdateInput,
  signal?: AbortSignal,
) => pool.verifyModelCatalog(input, signal);

export const readSkillCatalogAsync = (input: SkillCatalogInput, signal?: AbortSignal) =>
  pool.readSkillCatalog(input, signal);

export const findSkillSourceDirsAsync = (source: string) => pool.findSkillSourceDirs(source);

export const readMcpMarketplaceAsync = (roots: string[], signal?: AbortSignal) =>
  pool.readMcpMarketplace(roots, signal);

export const readPresetCatalogAsync = (skillsRoot: string) => pool.readPresetCatalog(skillsRoot);

export const readPresetMembersAsync = (
  input: Parameters<typeof readPresetMemberProfiles>[0],
  signal?: AbortSignal,
) => pool.readPresetMembers(input, signal);

export const readPresetExpertAsync = (
  input: Parameters<WorkbenchArtifactWorkerPool['readPresetExpert']>[0],
) => pool.readPresetExpert(input);

export const readGgufPlacementAsync = (
  filePath: string,
  cacheTypeK?: string,
  cacheTypeV?: string,
  signal?: AbortSignal,
) => pool.readGgufPlacement(filePath, cacheTypeK, cacheTypeV, signal);

export const prepareCompanionImagesAsync = (
  sources: CompanionImageSource[],
  signal?: AbortSignal,
): Promise<CompanionPreparedImage[]> => pool.prepareImages(sources, signal);

export const inspectWorkspaceContentAsync = (
  content: Uint8Array,
  signal?: AbortSignal,
): Promise<WorkspaceContentInspection> => {
  if (content.byteLength > ArtifactWorkerLimit.WorkspaceContentBytes) {
    return Promise.reject(new Error('Workspace content input limit exceeded.'));
  }
  // Own a bounded immutable copy: transferring a pooled Node Buffer can detach
  // unrelated contents, and main still owns the bytes used for the file write.
  return pool.inspectContent(Uint8Array.from(content).buffer, signal);
};
