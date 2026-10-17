import { Button } from '@shared/components/ui/button';
import { Input } from '@shared/components/ui/input';
import { X } from 'lucide-react';
import React from 'react';
import { createPortal } from 'react-dom';

import { i18nService } from '../../../services/i18n';
import Modal from '../../common/Modal';

interface RemoteImportModalProps {
  open: boolean;
  inputRef: React.RefObject<HTMLInputElement | null>;
  source: string;
  onSourceChange: (value: string) => void;
  isDownloading: boolean;
  error: string;
  onSubmit: () => void;
  onClose: () => void;
}

/**
 * Remote (URL) skill import dialog. Rendered as a portal to document.body
 * while open; focus and Escape handling stay with the owner.
 */
export const RemoteImportModal: React.FC<RemoteImportModalProps> = ({
  open,
  inputRef,
  source,
  onSourceChange,
  isDownloading,
  error,
  onSubmit,
  onClose,
}) => {
  if (!open) return null;
  return createPortal(
    <Modal
      onClose={onClose}
      overlayClassName="theme-skill-modal-backdrop fixed inset-0 z-50 flex items-center justify-center"
      className="theme-skill-import-modal w-full max-w-md mx-4 p-6"
    >
      <div className="flex items-start justify-between">
        <div className="text-lg font-semibold text-foreground">
          {i18nService.t('remoteImportTitle')}
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onClose}
          className="theme-page-skills-manager-button-1"
          aria-label={i18nService.t('close')}
        >
          <X className="h-5 w-5" />
        </Button>
      </div>

      <div className="mt-4 space-y-3">
        <p className="text-sm text-muted-foreground">
          {i18nService.t('remoteSkillImportDescription')}
        </p>
        <div className="text-xs font-semibold tracking-wide text-muted-foreground">
          {i18nService.t('remoteSkillImportUrlLabel')}
        </div>
        <Input
          ref={inputRef}
          type="text"
          value={source}
          onChange={e => onSourceChange(e.target.value)}
          placeholder={i18nService.t('remoteSkillImportPlaceholder')}
          className="theme-page-skills-manager-input-1 w-full placeholder-secondary"
        />
        <p className="text-xs text-muted-foreground">
          {i18nService.t('remoteSkillImportExamples')}
        </p>
        {error && <div className="text-xs text-destructive">{error}</div>}
        <Button
          type="button"
          onClick={onSubmit}
          disabled={isDownloading || !source.trim()}
          className="theme-page-skills-manager-button-2 w-full"
        >
          {isDownloading ? i18nService.t('importingSkill') : i18nService.t('importSkill')}
        </Button>
      </div>
    </Modal>,
    document.body,
  );
};
