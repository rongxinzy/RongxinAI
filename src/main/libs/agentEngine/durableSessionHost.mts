/** Native execution setup and resource configuration shared by desktop sessions. */
import {
  createRegistry,
  defineExtension,
  Harness,
  MemoryStorage,
  type Conversation,
  type Extension,
  type ModelRef,
  type ToolRegistration,
  type ConversationId,
  type HarnessSettings,
} from '@earendil-works/pi-durable';
import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context';
import { createCodingTools, createPowerShellTool } from '@earendil-works/pi-durable/tools';
import { NodeExecutionEnv } from '@earendil-works/pi-durable/env/node';
import { openNodeSqliteStorage } from '@earendil-works/pi-durable/storage/sqlite/node';
import type { ModelThinkingLevel } from '@earendil-works/pi-ai';
import type { DurableModelCatalog } from './durableModelCatalog.mjs';
import { toDurableTool, type ToolDefinition } from './durableToolTypes.js';
import type { PiResourceLoader } from './piRuntimeSessionState.js';
import { createDurableImageProcessor } from './durableImages.js';
import { currentDurableInvocation } from './durableInvocation.mjs';
import { createDurableSearchTools } from './durableSearchTools.mjs';
import { RuntimeConfiguration } from './durableSessionMetadata.mjs';
import { durableMemoryEvents } from './durableMemoryExtension.mjs';
import type { DurableMemoryBinding } from '../../memory/markdownMemoryRuntime.js';
import { durableCompactionPolicy } from './durableModelPolicy.js';
import { bindNativeToolContext } from './durableNativeToolContext.mjs';
const context = BACKGROUND_CONTEXT;
export interface DurableSessionOptions {
  cwd?: string;
  durableFile?: string;
  model: Record<string, unknown>;
  modelRuntime: DurableModelCatalog;
  resourceLoader?: PiResourceLoader;
  customTools?: ToolDefinition[];
  tools?: string[];
  noTools?: string;
  thinkingLevel?: ModelThinkingLevel;
  runtimeOptions?: Record<string, unknown>;
  memoryBinding?: DurableMemoryBinding | null;
  settings?: HarnessSettings;
}

export class DurableSessionHost {
  protected configuredTools: ToolRegistration[] = [];
  protected readonly registry = createRegistry();
  protected extensions: Extension[] = [];
  protected harness!: Harness;
  protected conversation!: Conversation;
  protected nativeStorageClosed = true;
  protected constructor(protected readonly options: DurableSessionOptions) {}
  protected async initializeNative(): Promise<void> {
    const images = createDurableImageProcessor(
      () => currentDurableInvocation()?.context.abortSignal,
    );
    const coding = createCodingTools({ images });
    this.registry.install({ ...coding, tools: coding.tools?.map(bindNativeToolContext) });
    this.registry.install(
      defineExtension({
        name: 'zhiyuan.search',
        tools: createDurableSearchTools(),
      }),
    );
    if (process.platform === 'win32')
      this.registry.install(
        defineExtension({
          name: 'zhiyuan.powershell',
          tools: [createPowerShellTool()],
        }),
      );
    this.registry.install(
      defineExtension({
        name: 'zhiyuan.tools',
        tools: (this.options.customTools ?? []).map(tool =>
          toDurableTool(tool, (id, observer, context, window) =>
            this.harness.observeConversation(id, observer, context, window),
          ),
        ),
      }),
    );
    this.installResources();
    const storage = this.options.durableFile
      ? await openNodeSqliteStorage(this.options.durableFile)
      : new MemoryStorage();
    this.nativeStorageClosed = false;
    const closeStorage = storage.close.bind(storage);
    storage.close = async closeContext => {
      await closeStorage(closeContext);
      this.nativeStorageClosed = true;
    };
    try {
      this.harness = await Harness.open(
        storage,
        {
          models: () => this.options.modelRuntime.models,
          registry: this.registry,
          env: target =>
            new NodeExecutionEnv({ cwd: target.cwd ?? this.options.cwd ?? process.cwd() }),
          identity: { attribution: null },
          settings: {
            ...this.options.settings,
            stream: { timeoutMs: 600_000, maxRetries: 0, ...this.options.settings?.stream },
          },
          onReport: report => console.warn('[DurableRuntime] execution report:', report),
        },
        context,
      );
    } catch (error) {
      await storage.close(context);
      throw error;
    }
    const stored = await this.harness.snapshot(RuntimeConfiguration, context);
    this.conversation =
      (stored &&
        (await this.harness.conversation(stored.conversationId as ConversationId, context))) ??
      (await this.harness.root(context));
    this.options.memoryBinding?.bindConversation(this.conversation);
    if (this.options.runtimeOptions)
      await this.harness.commit(async tx => {
        const configuration = await tx.doc(RuntimeConfiguration);
        configuration.options = JSON.parse(JSON.stringify(this.options.runtimeOptions));
      }, context);
    await this.configure();
  }

  protected installResources(): void {
    for (const extension of this.extensions) this.registry.uninstall(extension);
    this.extensions = [
      ...(this.options.resourceLoader?.extensions ?? []),
      ...(this.options.memoryBinding
        ? [this.options.memoryBinding.extension, durableMemoryEvents(this.options.memoryBinding)]
        : []),
    ];
    for (const extension of this.extensions) this.registry.install(extension);
  }

  protected async configure(): Promise<void> {
    const all = this.registry
      .snapshot()
      .tools()
      .map(({ tool }) => tool);
    const names =
      this.options.noTools === 'all'
        ? new Set<string>()
        : this.options.tools
          ? new Set(this.options.tools)
          : null;
    const resourceTools = new Set(
      this.extensions.flatMap(extension => extension.tools?.map(tool => tool.name) ?? []),
    );
    this.configuredTools = [...all].filter(
      tool =>
        !names ||
        names.has(tool.name) ||
        (this.options.noTools !== 'all' && resourceTools.has(tool.name)),
    );
    await this.conversation.configure(
      {
        cwd: this.options.cwd,
        model: this.modelRef(),
        thinkingLevel: this.options.thinkingLevel,
        instructions: this.options.resourceLoader?.getSystemPrompt(),
        compaction: durableCompactionPolicy(this.options.model),
        tools: this.configuredTools,
      },
      context,
    );
  }

  private modelRef(): ModelRef {
    const { provider, id } = this.options.model;
    if (typeof provider !== 'string' || typeof id !== 'string')
      throw new Error('Invalid model identity.');
    return { provider, modelId: id };
  }

  getDurableHost() {
    return { harness: this.harness, registry: this.registry, conversation: this.conversation };
  }
  getToolDefinition(name: string): ToolRegistration | undefined {
    return this.configuredTools.find(tool => tool.name === name);
  }
}
