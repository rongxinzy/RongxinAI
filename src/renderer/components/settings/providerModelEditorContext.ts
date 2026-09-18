import type { ApiFormat, DiscoveredProviderModel } from '../../../shared/providers';
import {
  resolveDiscoveredModelContext,
  resolveOllamaRunningModelContext,
} from './ollamaRuntimeMetadata';

export interface OllamaModelEditorContextInput {
  /** 已经按 apiFormat 解析过的地址，调用方负责解析，避免这里重复一套 provider 规则。 */
  baseUrl: string;
  apiFormat: ApiFormat;
  apiKey: string;
  modelId: string;
}

async function resolveRunningModelContext(modelId: string): Promise<number | undefined> {
  try {
    const runningModels = await window.electron.ollama.listRunningModels();
    return resolveOllamaRunningModelContext(modelId, runningModels);
  } catch (error) {
    console.debug('[ProviderModelEditor] failed to read running Ollama models:', error);
    return undefined;
  }
}

/**
 * Ollama 模型编辑框需要一个上下文窗口：先问一次 /models，拿不到就退回本地已加载模型，
 * 两次都拿不到就返回 undefined，让编辑框使用模型已有的配置。
 */
export async function resolveOllamaModelEditorContext(
  input: OllamaModelEditorContextInput,
): Promise<number | undefined> {
  try {
    const result = await window.electron.api.fetchModels({
      baseUrl: input.baseUrl,
      apiKey: input.apiKey,
      apiFormat: input.apiFormat,
    });
    if (result.success) {
      const discovered: readonly DiscoveredProviderModel[] = result.models;
      const contextWindow = resolveDiscoveredModelContext(input.modelId, discovered);
      if (contextWindow !== undefined) return contextWindow;
    }
  } catch (error) {
    // 拿不到就交给本地运行时兜底，但要在控制台留痕，方便排查上下文窗口为什么没解析出来。
    console.debug('[ProviderModelEditor] failed to resolve model context from /models:', error);
  }
  return resolveRunningModelContext(input.modelId);
}
