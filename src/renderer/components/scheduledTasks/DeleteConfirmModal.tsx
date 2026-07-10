import { Button } from '@shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shared/components/ui/dialog';
import { TriangleAlert } from 'lucide-react';
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
    <Dialog open onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <div className="flex flex-col items-center text-center">
            <div className="size-10 rounded-full bg-destructive/10 flex items-center justify-center mb-3">
              <TriangleAlert className="size-5 text-destructive" />
            </div>
            <DialogTitle>{i18nService.t('scheduledTasksDelete')}</DialogTitle>
            <DialogDescription>
              {i18nService.t('scheduledTasksDeleteConfirm').replace('{name}', taskName)}
            </DialogDescription>
          </div>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
          >
            {i18nService.t('cancel')}
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={onConfirm}
          >
            {i18nService.t('scheduledTasksDelete')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default DeleteConfirmModal;
