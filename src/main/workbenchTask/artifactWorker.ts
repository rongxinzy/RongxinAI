import { runTextWorkerOperation } from './textWorkerOperations';
import { parentPort } from 'node:worker_threads';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import {
  ArtifactWorkerLimit,
  ArtifactWorkerTask,
  CoworkImageLimit,
} from './artifactWorkerConstants';
import type { ArtifactWorkerInput } from './artifactWorkerTypes';
import { prepareCompanionImages } from '../companion/prepareImages.mjs';
import { scanLocalGgufModels } from '../libs/llamacppModelCatalog';
import { readGgufPlacementMetadata } from '../libs/ggufMetadata';
import { verifyModelCatalogUpdate } from '../libs/verifyModelCatalogUpdate';
import { readSkillCatalog } from '../skills/skillRecords';
import { loadBundledMcpMarketplace } from '../mcpMarketplace';
import { collectSkillDirsFromSource } from '../skills/skillDirs';
import { SkillCatalogLimit } from '../skills/constants';
import { listPresetExperts } from '../presetExpertCatalog';
import {
  readPresetMemberProfiles,
  resolveBundledPresetExpertSnapshot,
} from '../presetExpertSnapshot';

async function readCoworkImage(filePath: string): Promise<string> {
  const file = await open(filePath, constants.O_RDONLY | constants.O_NONBLOCK);
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size === 0 || info.size > CoworkImageLimit.Bytes) return '';
    const bytes = Buffer.allocUnsafe(info.size + 1);
    let offset = 0;
    while (offset < bytes.length) {
      const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    return offset === info.size ? bytes.toString('base64', 0, offset) : '';
  } finally {
    await file.close();
  }
}

parentPort?.on('message', async (job: ArtifactWorkerInput) => {
  const startedAt = performance.now();
  try {
    if (job.kind === ArtifactWorkerTask.PrepareCompanionImages) {
      const images = await prepareCompanionImages(job.input.sources);
      parentPort?.postMessage({ images, runMs: performance.now() - startedAt });
    } else if (job.kind === ArtifactWorkerTask.DecodeCoworkImage) {
      const { data } = job.input;
      if (
        data.length >
        CoworkImageLimit.Base64Characters + CoworkImageLimit.DataUrlHeaderCharacters
      )
        throw new Error('Image limit exceeded.');
      const comma = data.startsWith('data:') ? data.indexOf(',') : -1;
      const decoded = Buffer.from(comma < 0 ? data : data.slice(comma + 1), 'base64');
      if (decoded.length === 0 || decoded.length > CoworkImageLimit.Bytes) {
        parentPort?.postMessage({ decodedImage: null, runMs: performance.now() - startedAt });
        return;
      }
      const bytes = Uint8Array.from(decoded).buffer;
      const hash = createHash('sha256').update(decoded).digest('hex').slice(0, 32);
      parentPort?.postMessage(
        { decodedImage: { bytes, hash }, runMs: performance.now() - startedAt },
        [bytes],
      );
    } else if (job.kind === ArtifactWorkerTask.ReadCoworkImage) {
      const imageBase64 = await readCoworkImage(job.input.filePath);
      parentPort?.postMessage({ imageBase64, runMs: performance.now() - startedAt });
    } else if (job.kind === ArtifactWorkerTask.ScanLocalModels) {
      const models = scanLocalGgufModels(job.input.modelsDir);
      parentPort?.postMessage({ models, runMs: performance.now() - startedAt });
    } else if (job.kind === ArtifactWorkerTask.VerifyModelCatalog) {
      const catalogUpdate = verifyModelCatalogUpdate(job.input);
      parentPort?.postMessage({ catalogUpdate, runMs: performance.now() - startedAt });
    } else if (job.kind === ArtifactWorkerTask.ReadSkillCatalog) {
      const skills = readSkillCatalog(job.input);
      parentPort?.postMessage({ skills, runMs: performance.now() - startedAt });
    } else if (job.kind === ArtifactWorkerTask.ReadMcpMarketplace) {
      const marketplace = await loadBundledMcpMarketplace(job.input.roots);
      parentPort?.postMessage({ marketplace, runMs: performance.now() - startedAt });
    } else if (job.kind === ArtifactWorkerTask.FindSkillSourceDirs) {
      const directories = collectSkillDirsFromSource(job.input.source);
      if (directories.length > SkillCatalogLimit.Candidates)
        throw new Error('Skill source exceeds the supported number of Skills');
      parentPort?.postMessage({ directories, runMs: performance.now() - startedAt });
    } else if (job.kind === ArtifactWorkerTask.ReadPresetCatalog) {
      const experts = listPresetExperts(job.input.skillsRoot);
      parentPort?.postMessage({ experts, runMs: performance.now() - startedAt });
    } else if (job.kind === ArtifactWorkerTask.ReadPresetMembers) {
      const members = readPresetMemberProfiles(job.input);
      parentPort?.postMessage({ members, runMs: performance.now() - startedAt });
    } else if (job.kind === ArtifactWorkerTask.ReadPresetExpert) {
      const { skillsRoot, presetId, agentId } = job.input;
      const expert = resolveBundledPresetExpertSnapshot(skillsRoot, presetId, agentId);
      parentPort?.postMessage({ expert, runMs: performance.now() - startedAt });
    } else if (job.kind === ArtifactWorkerTask.ReadGgufPlacement) {
      const { filePath, cacheTypeK, cacheTypeV } = job.input;
      const placement = readGgufPlacementMetadata(filePath, cacheTypeK, cacheTypeV);
      parentPort?.postMessage({ placement, runMs: performance.now() - startedAt });
    } else if (job.kind === ArtifactWorkerTask.TransformText) {
      parentPort?.postMessage({
        text: runTextWorkerOperation(job.input),
        runMs: performance.now() - startedAt,
      });
    } else {
      if (
        !(job.input.bytes instanceof ArrayBuffer) ||
        job.input.bytes.byteLength > ArtifactWorkerLimit.WorkspaceContentBytes
      ) {
        throw new Error('Workspace content input limit exceeded.');
      }
      const bytes = Buffer.from(job.input.bytes);
      parentPort?.postMessage({
        content: {
          sha256: createHash('sha256').update(bytes).digest('hex'),
          text: bytes.toString('utf8'),
          binary: bytes.includes(0),
        },
        runMs: performance.now() - startedAt,
      });
    }
  } catch (error) {
    parentPort?.postMessage({
      error: error instanceof Error ? error.message : String(error),
      runMs: performance.now() - startedAt,
    });
  }
});
