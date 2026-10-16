import { Button } from '@shared/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@shared/components/ui/dialog';
import { Download, Image as ImageIcon } from 'lucide-react';
import React from 'react';

import { i18nService } from '../../../services/i18n';

interface SessionExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onExportImage: (event: React.MouseEvent) => void;
  onExportText: (format: 'md' | 'json') => void;
  disabled: boolean;
}

/** Share-options dialog: long-screenshot image export plus Markdown/JSON text export. */
export const SessionExportDialog: React.FC<SessionExportDialogProps> = ({
  open,
  onOpenChange,
  onExportImage,
  onExportText,
  disabled,
}) => {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xs">
        <DialogHeader>
          <DialogTitle className="text-base font-semibold">
            {i18nService.t('coworkExportAs')}
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-1 py-1">
          <Button
            variant="ghost"
            className="theme-action-row-large w-full justify-start gap-3"
            onClick={e => {
              onOpenChange(false);
              onExportImage(e);
            }}
            disabled={disabled}
          >
            <ImageIcon className="h-5 w-5 shrink-0" />
            <div className="text-left">
              <div className="font-medium">{i18nService.t('coworkExportImage')}</div>
              <div className="text-xs text-muted-foreground">
                {i18nService.t('coworkExportImageDesc')}
              </div>
            </div>
          </Button>
          <Button
            variant="ghost"
            className="theme-action-row-large w-full justify-start gap-3"
            onClick={() => {
              onOpenChange(false);
              onExportText('md');
            }}
          >
            <Download className="h-5 w-5 shrink-0" />
            <div className="text-left">
              <div className="font-medium">Markdown</div>
              <div className="text-xs text-muted-foreground">
                {i18nService.t('coworkExportMarkdownDesc')}
              </div>
            </div>
          </Button>
          <Button
            variant="ghost"
            className="theme-action-row-large w-full justify-start gap-3"
            onClick={() => {
              onOpenChange(false);
              onExportText('json');
            }}
          >
            <Download className="h-5 w-5 shrink-0" />
            <div className="text-left">
              <div className="font-medium">JSON</div>
              <div className="text-xs text-muted-foreground">
                {i18nService.t('coworkExportJSONDesc')}
              </div>
            </div>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
