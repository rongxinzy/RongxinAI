import { Badge } from '@shared/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@shared/components/ui/select';
import React from 'react';
import { useDispatch, useSelector } from 'react-redux';

import { i18nService } from '../services/i18n';
import { RootState } from '../store';
import type { Model } from '../store/slices/modelSlice';
import { getModelIdentityKey, setSelectedModel } from '../store/slices/modelSlice';

interface ModelSelectorProps {
  dropdownDirection?: 'up' | 'down' | 'auto';
  value?: Model | null;
  onChange?: (model: Model | null) => void;
  defaultLabel?: string;
  disabled?: boolean;
  isModelSelectable?: (model: Model) => boolean;
  portal?: boolean;
}

const DROPDOWN_MAX_HEIGHT = 256;

const ModelSelector: React.FC<ModelSelectorProps> = ({
  dropdownDirection = 'auto',
  value,
  onChange,
  defaultLabel,
  disabled = false,
  isModelSelectable,
}) => {
  const dispatch = useDispatch();
  const controlled = onChange !== undefined;
  const globalSelectedModel = useSelector((state: RootState) => state.model.defaultSelectedModel);
  const currentAgentId = useSelector((state: RootState) => state.agent.currentAgentId);
  const selectedModel = controlled ? (value ?? null) : globalSelectedModel;
  const availableModels = useSelector((state: RootState) => state.model.availableModels);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [resolvedSide, setResolvedSide] = React.useState<'top' | 'bottom'>('bottom');

  const handleOpenChange = (open: boolean) => {
    if (!open || dropdownDirection !== 'auto') return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const spaceBelow = window.innerHeight - rect.bottom;
    setResolvedSide(spaceBelow < DROPDOWN_MAX_HEIGHT && rect.top > spaceBelow ? 'top' : 'bottom');
  };

  const handleModelSelect = (key: string | null) => {
    if (disabled || key == null) return;

    if (defaultLabel && key === '__default__') {
      if (controlled) {
        onChange(null);
      }
      return;
    }

    const model = availableModels.find(m => getModelIdentityKey(m) === key) ?? null;
    if (!model || (isModelSelectable && !isModelSelectable(model))) {
      return;
    }

    if (controlled) {
      onChange(model);
    } else {
      dispatch(setSelectedModel({ agentId: currentAgentId, model }));
    }
  };

  if (availableModels.length === 0) {
    return (
      <div className="rounded-xl bg-surface px-3 py-1.5 text-sm text-muted-foreground">
        {i18nService.t('modelSelectorNoModels')}
      </div>
    );
  }

  const currentKey = selectedModel ? getModelIdentityKey(selectedModel) : '__default__';
  const triggerLabel = selectedModel?.name ?? defaultLabel ?? '';
  const side: 'top' | 'bottom' =
    dropdownDirection === 'up' ? 'top' : dropdownDirection === 'down' ? 'bottom' : resolvedSide;

  const renderModelItem = (model: Model) => {
    const selectable = isModelSelectable ? isModelSelectable(model) : true;

    return (
      <SelectItem
        key={getModelIdentityKey(model)}
        value={getModelIdentityKey(model)}
        disabled={!selectable}
        className="theme-control-sizing-1 items-start"
      >
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-sm font-medium text-foreground">{model.name}</span>
            {model.supportsImage ? (
              <Badge variant="outline">{i18nService.t('imageInput')}</Badge>
            ) : null}
          </div>
          {model.provider ? (
            <span className="truncate text-xs text-muted-foreground">{model.provider}</span>
          ) : null}
        </div>
      </SelectItem>
    );
  };

  return (
    <div ref={containerRef} className={`relative ${disabled ? 'cursor-wait' : 'cursor-pointer'}`}>
      <Select
        value={currentKey}
        onValueChange={handleModelSelect}
        onOpenChange={handleOpenChange}
        disabled={disabled}
      >
        <SelectTrigger
          className={` theme-page-model-selector-select-trigger-variant-1 max-w-[320px] disabled:cursor-wait ${disabled ? 'cursor-wait' : 'cursor-pointer'}`}
        >
          <SelectValue placeholder={defaultLabel}>
            <span className="truncate text-sm font-medium text-foreground">{triggerLabel}</span>
          </SelectValue>
        </SelectTrigger>
        <SelectContent side={side} className="w-72">
          {defaultLabel ? (
            <SelectGroup>
              <SelectItem value="__default__" className="theme-control-sizing-2">
                <span className="text-sm">{defaultLabel}</span>
              </SelectItem>
            </SelectGroup>
          ) : null}
          {defaultLabel ? <SelectSeparator /> : null}
          <SelectGroup>{availableModels.map(renderModelItem)}</SelectGroup>
        </SelectContent>
      </Select>
    </div>
  );
};

export default ModelSelector;
