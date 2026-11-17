import type {
  ModelPickerItem,
  ModelPickerLabels,
} from '@shared/components/model-picker/ModelPicker';
import type { Model } from '../../store/slices/modelSlice';
import { ModelCapabilityStatus } from '../../../shared/providers';
import { i18nService } from '../i18n';

interface DerivedModelCapabilities {
  vision: boolean;
  reasoning: boolean;
  webSearch: boolean;
  tools: boolean;
  contextWindow?: number;
  contextLabel?: string;
}

const RECENT_MODELS_STORAGE_KEY = 'zhiyuan.recentModelIds';
const MAX_RECENT_MODELS = 4;

function formatContextWindow(tokens?: number): string | undefined {
  if (!tokens || tokens <= 0) return undefined;
  if (tokens >= 1_000_000) {
    const m = tokens / 1_000_000;
    return Number.isInteger(m) ? `${m}M` : `${m.toFixed(1)}M`;
  }
  if (tokens >= 1000) {
    return `${Math.round(tokens / 1000)}K`;
  }
  return `${tokens}`;
}

function deriveModelCapabilities(model: Model): DerivedModelCapabilities {
  const vision =
    Boolean(model.supportsImage) ||
    model.capabilities?.imageInput === ModelCapabilityStatus.Supported;
  const reasoning =
    Boolean(model.supportsThinkingToggle) ||
    model.capabilities?.reasoning === ModelCapabilityStatus.Supported ||
    /deepseek-r|reasoner|o1|o3|o4|thinking|qwq/i.test(model.id);
  const webSearch = /search|online|web|sonar|perplexity|grok/i.test(model.id);
  const tools =
    model.capabilities?.toolCalling === ModelCapabilityStatus.Supported ||
    (!model.capabilities?.toolCalling && !model.id.startsWith('group/'));
  const contextWindow =
    model.contextWindow || model.llamaCppRuntimeContextWindow || model.llamaCppTrainedContextWindow;
  const contextLabel = formatContextWindow(contextWindow);

  return {
    vision,
    reasoning,
    webSearch,
    tools,
    contextWindow,
    contextLabel,
  };
}

function formatModelCapabilitiesSummary(caps: DerivedModelCapabilities): string {
  const parts: string[] = [];
  if (caps.vision) parts.push(i18nService.t('modelsPickerCapVision'));
  if (caps.reasoning) parts.push(i18nService.t('modelsPickerCapReasoning'));
  if (caps.webSearch) parts.push(i18nService.t('modelsPickerCapWebSearch'));
  if (caps.tools) parts.push(i18nService.t('modelsPickerCapTools'));
  if (caps.contextLabel) {
    parts.push(i18nService.t('modelsPickerContextTokens').replace('{tokens}', caps.contextLabel));
  }
  return parts.join(' · ');
}

export function getRecentModelIds(): string[] {
  if (typeof window === 'undefined' || !window.localStorage) return [];
  try {
    const raw = window.localStorage.getItem(RECENT_MODELS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}

export function recordRecentModelId(modelId: string): void {
  if (!modelId || typeof window === 'undefined' || !window.localStorage) return;
  try {
    const existing = getRecentModelIds().filter(id => id !== modelId);
    const next = [modelId, ...existing].slice(0, MAX_RECENT_MODELS);
    window.localStorage.setItem(RECENT_MODELS_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage quota errors in sandboxed views.
  }
}

function isLocalModelEntry(model: Pick<Model, 'id' | 'providerKey'>): boolean {
  return (
    model.providerKey === 'llamacpp' ||
    model.providerKey === 'ollama' ||
    model.id.startsWith('ollama/')
  );
}

function isGroupModelEntry(model: Pick<Model, 'id'>): boolean {
  return model.id.startsWith('group/');
}

export function toModelPickerItem(model: Model): ModelPickerItem {
  const caps = deriveModelCapabilities(model);
  return {
    id: model.id,
    name: model.name,
    providerLabel: model.provider || model.providerKey || '',
    providerKey: model.providerKey || (isGroupModelEntry(model) ? 'group' : undefined),
    providerBaseUrl: model.providerBaseUrl,
    isLocal: isLocalModelEntry(model),
    isGroup: isGroupModelEntry(model),
    vision: caps.vision,
    reasoning: caps.reasoning,
    webSearch: caps.webSearch,
    tools: caps.tools,
    contextLabel: caps.contextLabel,
    capabilitiesSummary: formatModelCapabilitiesSummary(caps),
  };
}

export function getModelPickerLabels(overrides?: Partial<ModelPickerLabels>): ModelPickerLabels {
  return {
    searchPlaceholder: i18nService.t('searchModels'),
    emptyModels: i18nService.t('modelSelectorNone'),
    noMatches: i18nService.t('modelSelectorNoMatches'),
    selectPlaceholder: i18nService.t('selectModel'),
    currentModelLabel: i18nService.t('currentModel'),
    recentGroup: i18nService.t('modelsPickerRecentGroup'),
    groupsGroup: i18nService.t('modelsPickerGroupsGroup'),
    localGroup: i18nService.t('modelsPickerLocalGroup'),
    otherGroup: i18nService.t('availableModels'),
    followDefault: i18nService.t('modelsScenarioFollowDefault'),
    manageAction: i18nService.t('modelsPickerManageAction'),
    visionLabel: i18nService.t('modelsPickerCapVision'),
    reasoningLabel: i18nService.t('modelsPickerCapReasoning'),
    webSearchLabel: i18nService.t('modelsPickerCapWebSearch'),
    toolsLabel: i18nService.t('modelsPickerCapTools'),
    ...overrides,
  };
}
