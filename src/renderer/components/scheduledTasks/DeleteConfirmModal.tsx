import { DestructiveConfirmDialog } from '@shared/components/ui/destructive-confirm-dialog';
import React from 'react';

import { i18nService } from '../../services/i18n';

interface DeleteConfirmModalProps {
  taskName: string;
  onConfirm: () => void;
  onCancel: () => void;
}

const DeleteConfirmModal: React.FC<DeleteConfirmModalProps> = ({
  taskName,
  onConfirm,
  onCancel,
}) => {
  return (
    <DestructiveConfirmDialog
      open
      title={i18nService.t('scheduledTasksDelete')}
      description={i18nService.t('scheduledTasksDeleteConfirm').replace('{name}', taskName)}
      cancelLabel={i18nService.t('cancel')}
      confirmLabel={i18nService.t('scheduledTasksDelete')}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
};

export default DeleteConfirmModal;
