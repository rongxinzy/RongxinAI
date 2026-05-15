import { CheckIcon,ChevronDownIcon } from '@heroicons/react/24/outline';
import React from 'react';
import { createPortal } from 'react-dom';
import { useDispatch,useSelector } from 'react-redux';

import { i18nService } from '../services/i18n';
import { RootState } from '../store';
import type { Model } from '../store/slices/modelSlice';
import { getModelIdentityKey,isSameModelIdentity, setSelectedModel } from '../store/slices/modelSlice';

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
const DROPDOWN_WIDTH = 240; // matches w-60
const DROPDOWN_VIEWPORT_MARGIN = 8;

const ModelSelector: React.FC<ModelSelectorProps> = ({
  dropdownDirection = 'auto',
  value,
  onChange,
  defaultLabel,
  disabled = false,
  portal = false,
}) => {
  const dispatch = useDispatch();
  const [isOpen, setIsOpen] = React.useState(false);
  const [resolvedDirection, setResolvedDirection] = React.useState<'up' | 'down'>('down');
  const [portalStyle, setPortalStyle] = React.useState<React.CSSProperties>({});
  const containerRef = React.useRef<HTMLDivElement>(null);
  const dropdownRef = React.useRef<HTMLDivElement>(null);

  const controlled = onChange !== undefined;
  const globalSelectedModel = useSelector((state: RootState) => state.model.defaultSelectedModel);
  const currentAgentId = useSelector((state: RootState) => state.agent.currentAgentId);
  const selectedModel = controlled ? value ?? null : globalSelectedModel;
  const availableModels = useSelector((state: RootState) => state.model.availableModels);

  // 点击外部区域关闭下拉框
  React.useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      const isInsideTrigger = containerRef.current?.contains(target);
      const isInsideDropdown = dropdownRef.current?.contains(target);

      if (!isInsideTrigger && !isInsideDropdown) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside, true);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside, true);
    };
  }, [isOpen]);

  const resolveDirection = React.useCallback(() => {
    if (dropdownDirection !== 'auto') return dropdownDirection;
    if (!containerRef.current) return 'down';
    const rect = containerRef.current.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    return spaceBelow < DROPDOWN_MAX_HEIGHT && rect.top > spaceBelow ? 'up' : 'down';
  }, [dropdownDirection]);

  const updatePortalPosition = React.useCallback((direction: 'up' | 'down') => {
    if (!containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    const left = Math.min(
      Math.max(rect.left, DROPDOWN_VIEWPORT_MARGIN),
      window.innerWidth - DROPDOWN_WIDTH - DROPDOWN_VIEWPORT_MARGIN
    );
    const nextStyle: React.CSSProperties = {
      left,
      position: 'fixed',
      width: DROPDOWN_WIDTH,
      zIndex: 10000,
    };

    if (direction === 'up') {
      nextStyle.bottom = window.innerHeight - rect.top + 4;
    } else {
      nextStyle.top = rect.bottom + 4;
    }

    setPortalStyle(nextStyle);
  }, []);

  React.useEffect(() => {
    if (!isOpen || !portal) return;

    const handlePositionUpdate = () => updatePortalPosition(resolvedDirection);
    window.addEventListener('resize', handlePositionUpdate);
    window.addEventListener('scroll', handlePositionUpdate, true);

    return () => {
      window.removeEventListener('resize', handlePositionUpdate);
      window.removeEventListener('scroll', handlePositionUpdate, true);
    };
  }, [isOpen, portal, resolvedDirection, updatePortalPosition]);

  const toggleOpen = () => {
    if (disabled) return;
    if (!isOpen) {
      const nextDirection = resolveDirection();
      setResolvedDirection(nextDirection);
      if (portal) {
        updatePortalPosition(nextDirection);
      }
      setIsOpen(true);
    } else {
      setIsOpen(false);
    }
  };

  const handleModelSelect = (model: Model | null) => {
    if (disabled) return;
    if (controlled) {
      onChange(model);
    } else if (model) {
      dispatch(setSelectedModel({ agentId: currentAgentId, model }));
    }
    setIsOpen(false);
  };

  // 如果没有可用模型，显示提示
  if (availableModels.length === 0) {
    return (
      <div className="px-3 py-1.5 rounded-xl bg-surface text-secondary text-sm">
        {i18nService.t('modelSelectorNoModels')}
      </div>
    );
  }

  const dropdownPositionClass = resolvedDirection === 'up'
    ? 'bottom-full mb-1'
    : 'top-full mt-1';

  const serverModels = availableModels.filter(m => m.isServerModel);
  const userModels = availableModels.filter(m => !m.isServerModel);
  const hasBothGroups = serverModels.length > 0 && userModels.length > 0;

  const isSelected = (model: Model): boolean => {
    if (!selectedModel) return false;
    return isSameModelIdentity(model, selectedModel);
  };

  const renderModelItem = (model: Model) => (
    <button
      type="button"
      key={getModelIdentityKey(model)}
      onClick={() => handleModelSelect(model)}
      className={`w-full px-4 py-2.5 text-left dark:text-claude-darkText text-claude-text dark:hover:bg-claude-darkSurfaceHover hover:bg-claude-surfaceHover flex items-center justify-between transition-colors ${
        isSelected(model) ? 'dark:bg-claude-darkSurfaceHover/50 bg-claude-surfaceHover/50' : ''
      }`}
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
          <span className="text-xs text-secondary truncate">{model.provider}</span>
        )}
      </div>
      {isSelected(model) && (
        <CheckIcon className="h-4 w-4 shrink-0 text-claude-accent" />
      )}
    </button>
  );

  const renderGroupHeader = (label: string) => (
    <div className="px-4 py-1.5 text-xs font-medium text-secondary uppercase tracking-wider">
      {label}
    </div>
  );

  const dropdown = isOpen ? (
    <div
      ref={dropdownRef}
      style={portal ? portalStyle : undefined}
      className={`${portal ? '' : `absolute ${dropdownPositionClass}`} w-60 bg-surface rounded-xl popover-enter shadow-popover z-50 border-border border overflow-hidden`}
    >
      <div className="max-h-64 overflow-y-auto">
        {defaultLabel && (
          <button
            type="button"
            onClick={() => handleModelSelect(null)}
            className={`w-full px-4 py-2.5 text-left dark:text-claude-darkText text-claude-text dark:hover:bg-claude-darkSurfaceHover hover:bg-claude-surfaceHover flex items-center justify-between transition-colors ${
              !selectedModel ? 'dark:bg-claude-darkSurfaceHover/50 bg-claude-surfaceHover/50' : ''
            }`}
          >
            <span className="text-sm">{defaultLabel}</span>
            {!selectedModel && <CheckIcon className="h-4 w-4 text-claude-accent" />}
          </button>
        )}
        {hasBothGroups ? (
          <>
            {renderGroupHeader(i18nService.t('modelGroupServer'))}
            {serverModels.map(renderModelItem)}
            <div className="my-1 border-t border-border" />
            {renderGroupHeader(i18nService.t('modelGroupUser'))}
            {userModels.map(renderModelItem)}
          </>
        ) : (
          availableModels.map(renderModelItem)
        )}
      </div>
    </div>
  ) : null;

  return (
    <div ref={containerRef} className={`relative ${disabled ? 'cursor-wait' : 'cursor-pointer'}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={toggleOpen}
        className={`flex items-center space-x-2 px-3 py-1.5 rounded-xl hover:bg-surface-raised text-foreground transition-colors max-w-[280px] disabled:opacity-70 disabled:cursor-wait ${isOpen ? 'bg-surface-raised' : ''}`}
      >
        <span className="font-medium text-sm truncate">{selectedModel?.name ?? defaultLabel ?? i18nService.t('selectModel')}</span>
        <ChevronDownIcon className="h-4 w-4 shrink-0 dark:text-claude-darkTextSecondary text-claude-textSecondary" />
      </button>

      {portal && dropdown ? createPortal(dropdown, document.body) : dropdown}
    </div>
  );
};

export default ModelSelector;
