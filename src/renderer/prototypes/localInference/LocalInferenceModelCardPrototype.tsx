import { Button21st } from '../../../shared/components/ui/button-21st';
import type {
  LlamaCppModel,
  LlamaCppModelPreferences,
  LlamaCppRunningModel,
} from '../../../shared/llamacpp';
import { ModelsPanel } from '../../components/localInference/panels/ModelsPanel';
import { i18nService } from '../../services/i18n';
import {
  LocalInferenceModelCardPrototypeState,
  RendererPrototypeQuery,
} from '../constants';

const prototypeModelName = 'Qwen2.5-0.5B-Instruct-GGUF';

const prototypeModels: LlamaCppModel[] = [
  createPrototypeModel({
    name: prototypeModelName,
    family: 'qwen2',
    parameterSize: '0.5B',
    quantization: 'Q4_K_M',
    contextLength: 131072,
    size: 491400032,
    modifiedAt: '2026-07-16T02:02:08.000Z',
  }),
  createPrototypeModel({
    name: 'DeepSeek-R1-Distill-Qwen-7B-GGUF',
    family: 'deepseek',
    parameterSize: '7B',
    quantization: 'Q4_K_M',
    contextLength: 65536,
    size: 4685824000,
    modifiedAt: '2026-07-15T11:24:18.000Z',
  }),
  createPrototypeModel({
    name: 'Kimi-K2-Instruct-GGUF',
    family: 'moonshot',
    parameterSize: '7B',
    quantization: 'Q5_K_M',
    contextLength: 131072,
    size: 5872025600,
    modifiedAt: '2026-07-14T09:42:31.000Z',
  }),
  createPrototypeModel({
    name: 'GLM-4-9B-Chat-GGUF',
    family: 'chatglm',
    parameterSize: '9B',
    quantization: 'Q4_K_M',
    contextLength: 32768,
    size: 6123683840,
    modifiedAt: '2026-07-12T16:08:44.000Z',
  }),
  createPrototypeModel({
    name: 'Gemma-3-4B-It-GGUF',
    family: 'gemma',
    parameterSize: '4B',
    quantization: 'Q4_K_M',
    contextLength: 32768,
    size: 2841640960,
    modifiedAt: '2026-07-10T05:36:10.000Z',
  }),
  createPrototypeModel({
    name: 'Doubao-Seed-1.6-GGUF',
    family: 'doubao',
    parameterSize: '8B',
    quantization: 'Q5_K_M',
    contextLength: 65536,
    size: 6308233216,
    modifiedAt: '2026-07-08T19:18:52.000Z',
  }),
];

const prototypePreferences: LlamaCppModelPreferences = Object.fromEntries(
  prototypeModels.map(model => [
    model.name,
    {
      ctxSize: model.runtime_context_length,
    },
  ]),
);

export function LocalInferenceModelCardPrototype() {
  const state = resolvePrototypeState();
  const runningModels = resolveRunningModels(state);

  return (
    <main className="h-screen overflow-auto bg-background p-6">
      <div className="mx-auto max-w-6xl">
        <ModelsPanel
          loading={false}
          loadingModelName={state === LocalInferenceModelCardPrototypeState.Loading ? prototypeModelName : null}
          unloadingModelName={state === LocalInferenceModelCardPrototypeState.Unloading ? prototypeModelName : null}
          localModels={prototypeModels}
          runningModels={runningModels}
          modelPreferences={prototypePreferences}
          onLoadModel={() => undefined}
          onUnload={() => undefined}
          onDelete={() => undefined}
          onConfigureContext={() => undefined}
          renderLoadButton={renderPrototypeLoadButton}
          showRegisteredModelsTitle={false}
        />
      </div>
    </main>
  );
}

function renderPrototypeLoadButton(
  _model: LlamaCppModel,
  { disabled, onClick }: { disabled: boolean; onClick: () => void },
) {
  return (
    <Button21st type="button" isDisabled={disabled} onClick={onClick}>
      {i18nService.t('start')}
    </Button21st>
  );
}

function createPrototypeModel({
  name,
  family,
  parameterSize,
  quantization,
  contextLength,
  size,
  modifiedAt,
}: {
  name: string;
  family: string;
  parameterSize: string;
  quantization: string;
  contextLength: number;
  size: number;
  modifiedAt: string;
}): LlamaCppModel {
  return {
    id: name,
    name,
    model: name,
    source: 'modelscope',
    path: `C:\\RongxinAI\\prototype-models\\${name.toLowerCase()}\\model.gguf`,
    modified_at: modifiedAt,
    size,
    details: {
      family,
      format: 'gguf',
      parameter_size: parameterSize,
      quantization_level: quantization,
      context_length: contextLength,
    },
    trained_context_length: contextLength,
    runtime_context_length: contextLength,
  };
}

function resolveRunningModels(state: LocalInferenceModelCardPrototypeState): LlamaCppRunningModel[] {
  if (!isRunningState(state)) return [];

  const runningModel = prototypeModels.find(model => model.name === prototypeModelName);
  return runningModel
    ? [
        {
          ...runningModel,
          context_length: runningModel.runtime_context_length,
        },
      ]
    : [];
}

function resolvePrototypeState(): LocalInferenceModelCardPrototypeState {
  const state = new URLSearchParams(window.location.search).get(RendererPrototypeQuery.ModelCardState);
  return isPrototypeState(state) ? state : LocalInferenceModelCardPrototypeState.Idle;
}

function isPrototypeState(value: string | null): value is LocalInferenceModelCardPrototypeState {
  return Object.values(LocalInferenceModelCardPrototypeState).some(state => state === value);
}

function isRunningState(state: LocalInferenceModelCardPrototypeState): boolean {
  return state === LocalInferenceModelCardPrototypeState.Running
    || state === LocalInferenceModelCardPrototypeState.Unloading;
}