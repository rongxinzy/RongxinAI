// Service detect/start/stop and quit lifecycle (#1069).
import type { ChildProcess } from 'child_process';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

import { applyAutomaticLlamaCppServiceDefaults } from '../../../shared/llamacpp';
import type { LlamaCppRunningModel, LlamaCppStatusSnapshot } from '../../../shared/llamacpp';
import { LlamaCppClient } from '../llamacppClient';
import {
  createLlamaCppServerSpawnOptions,
  shouldKeepLlamaCppServiceRunning,
} from '../llamacppProcessLifecycle';
import { findLlamaCppExecutable } from '../llamacppRuntimePaths';
import {
  buildLlamaCppServeEnv,
  buildLlamaServerArgs,
  filterLlamaCppServiceConfigByRuntimeCapabilities,
  shouldEnableLlamaCppModelsAutoload,
} from '../llamacppServe';
import { getNvidiaSmiSnapshot } from '../nvidiaSmi';
import {
  LlamaCppManagerLifecycleEvent,
  LlamaCppProcessOutputStream,
  type LlamaCppModelsUnloadedForQuitEvent,
} from './types';
import { LlamaCppManagerBackendOps } from './backendOps';
import type { LlamaCppManagerDownstreamSurface } from './types';

const QUIT_RUNNING_MODELS_TIMEOUT_MS = 1500;
const QUIT_UNLOAD_MODEL_TIMEOUT_MS = 3000;

export class LlamaCppManagerService extends LlamaCppManagerBackendOps {
  async detect(): Promise<LlamaCppStatusSnapshot> {
    const client = new LlamaCppClient(this.getBaseUrl());
    try {
      const version = await client.version(300);
      this.setStatus({
        status: 'running',
        version: version.version,
        executablePath: this.executablePath ?? undefined,
        pid: this.process?.pid,
        managedByApp: Boolean(this.process),
      });
      return this.status;
    } catch {
      // Continue with executable detection.
    }

    const executablePath = await findLlamaCppExecutable(this.getServiceConfig());
    this.executablePath = executablePath;
    this.setStatus({
      status: executablePath ? 'installed' : 'not-installed',
      executablePath: executablePath ?? undefined,
      managedByApp: false,
    });
    return this.status;
  }

  async start(): Promise<LlamaCppStatusSnapshot> {
    if (await this.isHealthy()) return this.status;

    if (!this.executablePath) {
      this.executablePath = await findLlamaCppExecutable(this.getServiceConfig());
    }
    if (!this.executablePath) {
      this.setStatus({ status: 'not-installed', managedByApp: false });
      return this.status;
    }

    fs.mkdirSync(this.getModelsDir(), { recursive: true });
    fs.mkdirSync(path.dirname(this.getPresetPath()), { recursive: true });
    if (!fs.existsSync(this.getPresetPath())) {
      fs.writeFileSync(this.getPresetPath(), 'version = 1\n\n', 'utf-8');
    }

    const runtimeConfig = await this.resolveRuntimeServiceConfig();
    const nvidiaSnapshot = process.platform === 'win32' ? await getNvidiaSmiSnapshot() : null;
    const resolvedRuntimeConfig = applyAutomaticLlamaCppServiceDefaults(runtimeConfig, {
      nvidiaSnapshot,
    });
    const runtimeCapabilities = await this.getRuntimeCapabilities().catch((): null => null);
    const filteredRuntimeConfig = filterLlamaCppServiceConfigByRuntimeCapabilities(
      resolvedRuntimeConfig,
      runtimeCapabilities,
    );
    this.setStatus({ status: 'starting', executablePath: this.executablePath, managedByApp: true });
    const keepRunningOnAppQuit = shouldKeepLlamaCppServiceRunning(filteredRuntimeConfig);
    const serviceProcess = spawn(
      this.executablePath,
      buildLlamaServerArgs(filteredRuntimeConfig, this.getModelsDir(), this.getPresetPath()),
      createLlamaCppServerSpawnOptions({
        config: filteredRuntimeConfig,
        env: buildLlamaCppServeEnv(process.env, this.executablePath, process.platform),
      }),
    );
    this.process = serviceProcess;
    if (keepRunningOnAppQuit) serviceProcess.unref();

    this.startupStderr = '';
    serviceProcess.stdout?.on('data', chunk => {
      this.handleProcessOutput(LlamaCppProcessOutputStream.Stdout, chunk);
    });
    serviceProcess.stderr?.on('data', chunk => {
      const text = this.handleProcessOutput(LlamaCppProcessOutputStream.Stderr, chunk);
      if (!text) return;
      this.startupStderr += (this.startupStderr ? '\n' : '') + text;
    });
    serviceProcess.on('exit', (code, signal) => {
      console.log(
        `[LlamaCpp] process exited with code ${code ?? 'null'} and signal ${signal ?? 'null'}`,
      );
      this.process = null;
      if (this.status.status === 'starting') {
        const exitDetail = this.formatStartupExitDetail(code, signal);
        const stderrSnippet = this.startupStderr
          ? `: ${this.startupStderr.slice(0, 300)} (${exitDetail})`
          : ` (${exitDetail})`;
        this.setStatus({
          status: 'error',
          error: `llama.cpp exited unexpectedly during startup${stderrSnippet}`,
          executablePath: this.executablePath ?? undefined,
          managedByApp: false,
        });
        return;
      }
      if (this.status.status === 'running') {
        this.setStatus({
          status: 'stopped',
          executablePath: this.executablePath ?? undefined,
          managedByApp: false,
        });
      }
    });
    serviceProcess.on('error', error => {
      console.warn('[LlamaCpp] process failed:', error);
      this.setStatus({
        status: 'error',
        error: error.message,
        executablePath: this.executablePath ?? undefined,
        managedByApp: false,
      });
    });

    await Promise.race([
      this.waitUntilHealthy(this.getConnectionAndLoadTimeoutMs()),
      this.waitForStartupProcessExit(serviceProcess),
    ]);
    return this.status;
  }

  async stop(): Promise<LlamaCppStatusSnapshot> {
    if (!this.process) {
      if (await this.isHealthy()) {
        this.setStatus({
          status: 'running',
          executablePath: this.executablePath ?? undefined,
          managedByApp: false,
          error: 'llama.cpp is running outside this app and must be stopped externally.',
        });
        return this.status;
      }

      this.setStatus({
        status: 'stopped',
        executablePath: this.executablePath ?? undefined,
        managedByApp: false,
      });
      return this.status;
    }

    const child = this.process;
    await new Promise<void>(resolve => {
      const timeout = setTimeout(() => {
        child.kill('SIGKILL');
        resolve();
      }, 3000);
      child.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
      child.kill('SIGTERM');
    });
    this.process = null;
    if (await this.isHealthy()) {
      this.setStatus({
        status: 'running',
        executablePath: this.executablePath ?? undefined,
        managedByApp: false,
        error: 'llama.cpp is still running outside this app.',
      });
      return this.status;
    }

    this.setStatus({
      status: 'stopped',
      executablePath: this.executablePath ?? undefined,
      managedByApp: false,
    });
    return this.status;
  }

  async restart(): Promise<LlamaCppStatusSnapshot> {
    await this.stop();
    return await this.start();
  }

  async client(): Promise<LlamaCppClient> {
    if (this.status.status !== 'running') {
      await this.detect();
    }
    return new LlamaCppClient(this.getBaseUrl(), {
      loadTimeoutMs: this.getConnectionAndLoadTimeoutMs(),
    });
  }

  async shutdownForQuit(): Promise<LlamaCppStatusSnapshot> {
    if (shouldKeepLlamaCppServiceRunning(this.getServiceConfig())) {
      this.process?.unref();
      console.log('[LlamaCpp] keeping the local inference service running after app quit.');
      return this.status;
    }
    await this.unloadAllRunningModels();
    return await this.stop();
  }

  async unloadAllRunningModels(): Promise<void> {
    const client = new LlamaCppClient(this.getBaseUrl());
    let runningModels: LlamaCppRunningModel[];
    try {
      runningModels = await (this as unknown as LlamaCppManagerDownstreamSurface).listRunningModels(
        QUIT_RUNNING_MODELS_TIMEOUT_MS,
      );
    } catch (error) {
      console.debug(
        '[LlamaCpp] skipped model unload during quit because running models could not be listed:',
        error,
      );
      return;
    }

    const unloadModelNames = Array.from(
      new Set(runningModels.map(model => (model.name || model.model || '').trim()).filter(Boolean)),
    );
    const logModelNames = Array.from(
      new Set(
        runningModels
          .flatMap(model => [model.name, model.model, model.id])
          .map(value => value?.trim())
          .filter((value): value is string => Boolean(value)),
      ),
    );
    if (unloadModelNames.length === 0) return;

    console.log(`[LlamaCpp] unloading ${unloadModelNames.length} model(s) during app quit`);
    const results = await Promise.allSettled(
      unloadModelNames.map(async modelName => {
        await client.unloadModel(modelName, QUIT_UNLOAD_MODEL_TIMEOUT_MS);
      }),
    );
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        console.warn(
          `[LlamaCpp] failed to unload model ${unloadModelNames[index]} during quit:`,
          result.reason,
        );
      }
    });
    if (logModelNames.length > 0) {
      this.emit(LlamaCppManagerLifecycleEvent.ModelsUnloadedForQuit, {
        modelNames: logModelNames,
      } satisfies LlamaCppModelsUnloadedForQuitEvent);
    }
  }
}
