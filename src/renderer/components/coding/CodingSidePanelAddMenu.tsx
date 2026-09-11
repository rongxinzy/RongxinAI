import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@shared/components/ui/dropdown-menu';
import { Button } from '@shared/components/ui/button';
import { FileDiff, Folder, Plus, Terminal as TerminalIcon } from 'lucide-react';

import { i18nService } from '../../services/i18n';

interface CodingSidePanelAddMenuProps {
  onOpenReview: () => void;
  onOpenFiles: () => void;
  onOpenInspector: () => void;
  hasInspectorContent: boolean;
}

export const CodingSidePanelAddMenu = ({
  onOpenReview,
  onOpenFiles,
  onOpenInspector,
  hasInspectorContent,
}: CodingSidePanelAddMenuProps) => (
  <DropdownMenu>
    <DropdownMenuTrigger
      render={
        <Button
          type="button"
          variant="toolbar"
          size="icon-sm"
          aria-label={i18nService.t('codingAgentAddPage')}
        />
      }
    >
      <Plus />
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start" sideOffset={6} className="w-72">
      <DropdownMenuItem className="gap-2" onClick={onOpenReview}>
        <FileDiff />
        {i18nService.t('codingAgentReview')}
      </DropdownMenuItem>
      <DropdownMenuItem className="gap-2" onClick={onOpenFiles}>
        <Folder />
        {i18nService.t('codingAgentFiles')}
      </DropdownMenuItem>
      {hasInspectorContent ? (
        <DropdownMenuItem className="gap-2" onClick={onOpenInspector}>
          <TerminalIcon />
          {i18nService.t('codingAgentInspector')}
        </DropdownMenuItem>
      ) : null}
    </DropdownMenuContent>
  </DropdownMenu>
);
