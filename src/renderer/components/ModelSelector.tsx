import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shared/components/ui/select';
import React from 'react';
import { useDispatch, useSelector } from 'react-redux';

import { i18nService } from '../services/i18n';
import { RootState } from '../store';
import type { Model } from '../store/slices/modelSlice';
import {
  getModelIdentityKey,
  setSelectedModel,
} from '../store/slices/modelSlice';

interface ModelSelectorProps {
  dropdownDirection?: 'up' | 'down' | 'auto';
  /**
   * Controlled mode: the currently selected Model (or `null` for "default").
   * When provided, the component does NOT read/write Redux global state.
   */
  value?: Model | null;
  /** Controlled mode callback. `null` means the user picked "default". */
  onChange?: (model: Model | null) => void;
  /** Show a "default" option at the top of the dropdown (controlled mode only). */
  defaultLabel?: string;
  /** Disable interaction while the selected model is being persisted. */
  disabled?: boolean;
  /** Render the dropdown outside the local stacking context. */
  portal?: boolean;
}

const DROPDOWN_MAX_HEIGHT = 256; // matches max-h-64

const ModelSelector: React.FC<ModelSelectorProps> = ({
  dropdownDirection = 'auto',
  value,
  onChange,
  defaultLabel,
  disabled = false,
}) => {
  const dispatch = useDispatch();
  const controlled = onChange !== undefined;
  const globalSelectedModel = useSelector((state: RootState) => state.model.defaultSelectedModel);
  const currentAgentId = useSelector((state: RootState) => state.agent.currentAgentId);
  const selectedModel = controlled ? value ?? null : globalSelectedModel;
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

    const model = availableModels.find((m) => getModelIdentityKey(m) === key) ?? null;
    if (controlled) {
      onChange(model);
    } else if (model) {
      dispatch(setSelectedModel({ agentId: currentAgentId, model }));
    }
  };

  if (availableModels.length === 0) {
    return (
      <div className="px-3 py-1.5 rounded-xl bg-surface text-muted-foreground text-sm">
        {i18nService.t('modelSelectorNoModels')}
      </div>
    );
  }

  const serverModels = availableModels.filter((m) => m.isServerModel);
  const userModels = availableModels.filter((m) => !m.isServerModel);
  const hasBothGroups = serverModels.length > 0 && userModels.length > 0;

  const currentKey = selectedModel ? getModelIdentityKey(selectedModel) : '__default__';
  const triggerLabel = selectedModel?.name ?? defaultLabel ?? '';

  const side: 'top' | 'bottom' =
    dropdownDirection === 'up' ? 'top' : dropdownDirection === 'down' ? 'bottom' : resolvedSide;

  const renderModelItem = (model: Model) => (
    <SelectItem
      key={getModelIdentityKey(model)}
      value={getModelIdentityKey(model)}
      className="w-full px-4 py-2.5 text-left dark:text-claude-darkText text-claude-text dark:hover:bg-claude-darkSurfaceHover hover:bg-claude-surfaceHover flex items-center justify-between transition-colors"
    >
      <div className="flex flex-col min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-sm truncate">{model.name}</span>
          {model.supportsImage && (
            <span className="text-[10px] leading-none px-1.5 py-0.5 rounded-md bg-primary/10 text-primary whitespace-nowrap">
              {i18nService.t('imageInput')}
            </span>
          )}
        </div>
        {model.provider && (
          <span className="text-xs text-muted-foreground truncate">{model.provider}</span>
        )}
      </div>
    </SelectItem>
  );

  return (
    <div ref={containerRef} className={`relative ${disabled ? 'cursor-wait' : 'cursor-pointer'}`}>
      <Select
        value={currentKey}
        onValueChange={handleModelSelect}
        onOpenChange={handleOpenChange}
        disabled={disabled}
      >
        <SelectTrigger
          className={`flex items-center space-x-2 px-3 py-1.5 rounded-xl hover:bg-surface-raised text-foreground transition-colors max-w-[280px] disabled:opacity-70 disabled:cursor-wait h-auto border-none shadow-none bg-transparent ${disabled ? 'cursor-wait' : 'cursor-pointer'}`}
        >
          <SelectValue placeholder={defaultLabel}>
            <span className="font-medium text-sm truncate">{triggerLabel}</span>
          </SelectValue>
        </SelectTrigger>
        <SelectContent
          side={side}
          className="w-60 bg-surface rounded-xl popover-enter shadow-popover z-50 border-border border overflow-hidden"
        >
          <div className="max-h-64 overflow-y-auto">
            {defaultLabel && (
              <SelectItem
                value="__default__"
                className="w-full px-4 py-2.5 text-left dark:text-claude-darkText text-claude-text dark:hover:bg-claude-darkSurfaceHover hover:bg-claude-surfaceHover flex items-center justify-between transition-colors"
              >
                <span className="text-sm">{defaultLabel}</span>
              </SelectItem>
            )}
            {hasBothGroups ? (
              <>
                <div className="px-4 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  {i18nService.t('modelGroupServer')}
                </div>
                {serverModels.map(renderModelItem)}
                <div className="my-1 border-t border-border" />
                <div className="px-4 py-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  {i18nService.t('modelGroupUser')}
                </div>
                {userModels.map(renderModelItem)}
              </>
            ) : (
              availableModels.map(renderModelItem)
            )}
          </div>
        </SelectContent>
      </Select>
    </div>
  );
};

export default ModelSelector;
