import { Button } from '@shared/components/ui/button';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
} from '@shared/components/ui/input-group';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shared/components/ui/select';
import { cn } from '@shared/lib/utils';
import { ChevronDown } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import type { LlamaCppModel } from '../../../../shared/llamacpp';
import { i18nService } from '../../../services/i18n';
import Modal from '../../common/Modal';

const CONTEXT_DEFAULT_VALUE = 32768;
const CONTEXT_DEFAULT_MAX = 131072;
const TOKENS_PER_K = 1024;
const CONTEXT_PRESETS = [4096, 8192, 16384, 32768, 65536, 131072] as const;

const ContextSelectValue = {
  Custom: 'custom',
} as const;

export const ModelContextEditorMode = {
  Preset: 'preset',
  Custom: 'custom',
} as const;
export type ModelContextEditorMode =
  (typeof ModelContextEditorMode)[keyof typeof ModelContextEditorMode];

export const ModelContextSettingsPresentation = {
  Modal: 'modal',
  Inline: 'inline',
} as const;
export type ModelContextSettingsPresentation =
  (typeof ModelContextSettingsPresentation)[keyof typeof ModelContextSettingsPresentation];

type ModelContextSettingsModalProps = {
  isOpen: boolean;
  model: LlamaCppModel | null;
  savedContextSize?: number;
  savedNCpuMoe?: number;
  runningContextSize?: number;
  onClose: () => void;
  /** nCpuMoe is `{ value: number | undefined }` only when the field was edited; clearing it passes undefined inside the box. */
  onSave: (
    ctxSize?: number,
    contextChanged?: boolean,
    nCpuMoe?: { value: number | undefined },
  ) => void;
  onValidationError?: (message: string) => void;
  presentation?: ModelContextSettingsPresentation;
  inlineClassName?: string;
  hideContextEditor?: boolean;
  hideNCpuMoeEditor?: boolean;
};

export type ModelContextEditorState = {
  contextSize: number;
  mode: ModelContextEditorMode;
  customContextValue: string;
};

type ContextSizeControlProps = {
  model: LlamaCppModel;
  editorState: ModelContextEditorState;
  onEditorStateChange: (state: ModelContextEditorState) => void;
  className?: string;
};

export function ContextSizeControl({
  model,
  editorState,
  onEditorStateChange,
  className,
}: ContextSizeControlProps) {
  const trainedLimit = model.trained_context_length ?? model.details?.context_length;
  const contextPresets = useMemo(() => getContextPresets(trainedLimit), [trainedLimit]);
  const { contextSize, customContextValue, mode } = editorState;

  return mode === ModelContextEditorMode.Custom ? (
    <InputGroup className={cn('theme-control-sizing-22 w-full', className)}>
      <InputGroupInput
        type="number"
        min={1}
        step={1}
        value={customContextValue}
        aria-invalid={Boolean(
          getCustomContextError(
            parseCustomContextValue(customContextValue),
            customContextValue,
            trainedLimit,
          ),
        )}
        className="theme-part-model-context-settings-modal-input-group-input-1 appearance-none text-left [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        onChange={event => {
          const nextValue = event.target.value;
          const nextParsedValue = parseCustomContextValue(nextValue);
          onEditorStateChange({
            ...editorState,
            customContextValue: nextValue,
            ...(getCustomContextError(nextParsedValue, nextValue, trainedLimit) || !nextParsedValue
              ? {}
              : { contextSize: nextParsedValue }),
          });
        }}
      />
      <InputGroupAddon align="inline-end">
        <InputGroupText className="theme-part-model-context-settings-modal-input-group-text-1">
          K
        </InputGroupText>
        <InputGroupButton
          size="icon-xs"
          aria-label={i18nService.t('localInferenceConfigureContext')}
          onClick={() =>
            onEditorStateChange({
              ...editorState,
              mode: ModelContextEditorMode.Preset,
            })
          }
        >
          <ChevronDown />
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  ) : (
    <Select
      value={String(contextSize)}
      onValueChange={value => {
        if (!value) return;
        if (value === ContextSelectValue.Custom) {
          onEditorStateChange({
            ...editorState,
            mode: ModelContextEditorMode.Custom,
            customContextValue: formatContextKInput(contextSize),
          });
          return;
        }
        const nextContextSize = Number(value);
        if (Number.isSafeInteger(nextContextSize)) {
          onEditorStateChange({
            contextSize: nextContextSize,
            mode: ModelContextEditorMode.Preset,
            customContextValue: '',
          });
        }
      }}
    >
      <SelectTrigger size="sm" className={cn('w-full', className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectGroup>
          {contextPresets.map(preset => (
            <SelectItem key={preset} value={String(preset)}>
              {formatContextPreset(preset)}
            </SelectItem>
          ))}
          <SelectItem value={ContextSelectValue.Custom}>
            {i18nService.t('localInferenceContextCustom')}
          </SelectItem>
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}

export function ModelContextSettingsModal({
  isOpen,
  model,
  savedContextSize,
  savedNCpuMoe,
  runningContextSize,
  onClose,
  onSave,
  onValidationError,
  presentation = ModelContextSettingsPresentation.Modal,
  inlineClassName,
  hideContextEditor = false,
  hideNCpuMoeEditor = false,
}: ModelContextSettingsModalProps) {
  const [editorState, setEditorState] = useState<ModelContextEditorState>({
    contextSize: CONTEXT_DEFAULT_VALUE,
    mode: ModelContextEditorMode.Preset,
    customContextValue: '',
  });
  const [nCpuMoeValue, setNCpuMoeValue] = useState('');
  const [savedNCpuMoeValue, setSavedNCpuMoeValue] = useState<string | null>(null);

  const trainedLimit = model?.trained_context_length ?? model?.details?.context_length;
  const contextPresets = useMemo(() => getContextPresets(trainedLimit), [trainedLimit]);
  const initialContextSize = getInitialContextValue(
    savedContextSize,
    runningContextSize,
    contextPresets,
    trainedLimit,
  );
  const customContextError =
    editorState.mode === ModelContextEditorMode.Custom
      ? getCustomContextError(
          parseCustomContextValue(editorState.customContextValue),
          editorState.customContextValue,
          trainedLimit,
        )
      : null;

  useEffect(() => {
    if (!isOpen) return;
    setEditorState({
      contextSize: initialContextSize,
      mode: contextPresets.includes(initialContextSize)
        ? ModelContextEditorMode.Preset
        : ModelContextEditorMode.Custom,
      customContextValue: contextPresets.includes(initialContextSize)
        ? ''
        : formatContextKInput(initialContextSize),
    });
    setNCpuMoeValue(savedNCpuMoe === undefined ? '' : String(savedNCpuMoe));
    setSavedNCpuMoeValue(savedNCpuMoe === undefined ? '' : String(savedNCpuMoe));
  }, [contextPresets, initialContextSize, isOpen, model?.name, savedNCpuMoe]);

  if (!model) return null;

  const content = (
    <div
      className={cn(
        'flex flex-col gap-5',
        presentation === ModelContextSettingsPresentation.Modal && 'p-6',
      )}
    >
      {presentation === ModelContextSettingsPresentation.Modal ? (
        <div className="flex min-w-0 items-center gap-2">
          <h2 className="shrink-0 text-base font-semibold text-foreground">
            {i18nService.t('localInferenceConfigureContext')}
          </h2>
          <p className="min-w-0 truncate text-sm text-muted-foreground" title={model.name}>
            {model.name}
          </p>
        </div>
      ) : null}

      {!hideContextEditor ? (
        <div className="flex flex-col gap-3">
          <div className="flex min-h-7 items-center gap-0">
            <span className="text-sm font-medium text-muted-foreground">
              {i18nService.t('localInferenceServiceConfigCtxSizeLabel')}：
            </span>
            <ContextSizeControl
              model={model}
              editorState={editorState}
              onEditorStateChange={setEditorState}
            />
          </div>
          {editorState.mode === ModelContextEditorMode.Custom && customContextError ? (
            <p className="text-xs text-destructive">{customContextError}</p>
          ) : null}
        </div>
      ) : null}

      {!hideNCpuMoeEditor ? (
        <div className="flex flex-col gap-1.5">
          <div className="flex min-h-7 items-center gap-2">
            <span className="text-sm font-medium text-muted-foreground">
              {i18nService.t('localInferenceNCpuMoeLabel')}
            </span>
            <input
              type="number"
              min={0}
              step={1}
              value={nCpuMoeValue}
              aria-invalid={Boolean(getNCpuMoeError(nCpuMoeValue))}
              className="theme-control-sizing-22 h-7 w-28 rounded-md border border-border-subtle bg-transparent px-2 text-sm text-foreground outline-none focus-visible:border-border"
              onChange={event => setNCpuMoeValue(event.target.value)}
            />
          </div>
          {getNCpuMoeError(nCpuMoeValue) ? (
            <p className="text-xs text-destructive">{getNCpuMoeError(nCpuMoeValue)}</p>
          ) : (
            <p className="text-xs text-muted-foreground">
              {i18nService.t('localInferenceNCpuMoeHint')}
            </p>
          )}
        </div>
      ) : null}

      {runningContextSize ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border-subtle pt-3 text-xs">
          <span>
            <span className="text-muted-foreground">
              {i18nService.t('localInferenceContextRunning').replace('{value}', '')}
            </span>
            {formatContextPreset(runningContextSize)}
          </span>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button type="button" variant="ghost" className="min-w-16" onClick={onClose}>
          {i18nService.t('cancel')}
        </Button>
        <Button
          type="button"
          variant="default"
          className="min-w-16"
          onClick={() => {
            if (editorState.mode === ModelContextEditorMode.Custom) {
              if (!editorState.customContextValue.trim()) {
                onValidationError?.(i18nService.t('localInferenceContextInvalid'));
                return;
              }
              if (customContextError) {
                onValidationError?.(customContextError);
                return;
              }
            }
            if (!hideNCpuMoeEditor && getNCpuMoeError(nCpuMoeValue)) {
              onValidationError?.(getNCpuMoeError(nCpuMoeValue) as string);
              return;
            }
            const nCpuMoeEdited =
              !hideNCpuMoeEditor && nCpuMoeValue.trim() !== (savedNCpuMoeValue ?? '');
            onSave(
              editorState.contextSize,
              editorState.contextSize !== initialContextSize,
              nCpuMoeEdited ? { value: parseNCpuMoeValue(nCpuMoeValue) } : undefined,
            );
          }}
        >
          {i18nService.t('save')}
        </Button>
      </div>
    </div>
  );

  if (presentation === ModelContextSettingsPresentation.Inline) {
    return <div className={cn('w-full', inlineClassName)}>{content}</div>;
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      className="theme-local-context-modal w-full max-w-md p-0"
    >
      {content}
    </Modal>
  );
}
function formatContextPreset(value: number): string {
  if (value >= 1024) {
    const normalized = value / 1024;
    const display = Number.isInteger(normalized) ? normalized.toString() : normalized.toFixed(1);
    return `${display}K`;
  }
  return String(value);
}

export function formatContextKInput(value: number): string {
  return String(Number((value / TOKENS_PER_K).toFixed(2)));
}

export function getContextPresets(trainedLimit?: number): readonly number[] {
  const limit = trainedLimit ?? CONTEXT_DEFAULT_MAX;
  const presets = CONTEXT_PRESETS.filter(preset => preset <= limit);
  return presets.length > 0 ? presets : [Math.max(1, limit)];
}

export function getInitialContextValue(
  preferredContextSize: number | undefined,
  fallbackContextSize: number | undefined,
  contextPresets: readonly number[],
  trainedLimit?: number,
): number {
  const candidate = preferredContextSize ?? fallbackContextSize;
  if (
    candidate !== undefined &&
    Number.isInteger(candidate) &&
    candidate > 0 &&
    (!trainedLimit || candidate <= trainedLimit)
  ) {
    return candidate;
  }
  const nearestCandidate = candidate ?? CONTEXT_DEFAULT_VALUE;
  return contextPresets.reduce((closest, preset) =>
    Math.abs(preset - nearestCandidate) < Math.abs(closest - nearestCandidate) ? preset : closest,
  );
}

export function getCustomContextError(
  parsedValue: number | undefined,
  rawValue: string | null,
  trainedLimit?: number,
): string | null {
  if (rawValue === null) return null;
  if (!rawValue.trim()) return null;
  if (parsedValue === undefined || !Number.isInteger(parsedValue) || parsedValue <= 0) {
    return i18nService.t('localInferenceContextInvalid');
  }
  if (trainedLimit && parsedValue > trainedLimit) {
    return i18nService
      .t('localInferenceLaunchContextExceedsTrainingLimit')
      .replace('{requested}', String(parsedValue))
      .replace('{trained}', String(trainedLimit));
  }
  return null;
}

export function parseCustomContextValue(value: string | null): number | undefined {
  if (!value?.trim()) return undefined;
  const parsedK = Number(value.trim());
  return Number.isFinite(parsedK) ? Math.round(parsedK * TOKENS_PER_K) : undefined;
}

/** Empty means automatic (no saved value); undefined means "not edited". */
function parseNCpuMoeValue(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined;
}

function getNCpuMoeError(value: string): string | null {
  if (!value.trim()) return null;
  if (parseNCpuMoeValue(value) === undefined) {
    return i18nService.t('localInferenceNCpuMoeInvalid');
  }
  return null;
}
