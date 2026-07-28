import { Button } from '@shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@shared/components/ui/dialog';
import { Database, Plug, ShieldCheck, Unplug } from 'lucide-react';

import { i18nService } from '../../services/i18n';
import type { McpRegistryEntry } from '../../types/mcp';

interface McpOfficialConnectDialogProps {
  entry: McpRegistryEntry | null;
  iconSrc?: string;
  isConnecting: boolean;
  onClose: () => void;
  onConnect: () => void;
}

export function McpOfficialConnectDialog({
  entry,
  iconSrc,
  isConnecting,
  onClose,
  onConnect,
}: McpOfficialConnectDialogProps) {
  const isOpen = entry !== null;

  return (
    <Dialog open={isOpen} onOpenChange={open => !open && onClose()}>
      <DialogContent className="max-w-[38rem] gap-0 overflow-hidden p-0 sm:max-w-[38rem]" showCloseButton>
        {entry && (
          <>
            <DialogHeader className="items-center px-6 pt-8 pb-6 text-center">
              <div className="flex items-center">
                <div className="flex size-16 items-center justify-center overflow-hidden rounded-xl border border-border bg-card">
                  {iconSrc ? <img src={iconSrc} alt="" className="size-full object-contain" /> : <Plug className="size-8 text-foreground" />}
                </div>
              </div>
              <DialogTitle className="mt-5">{i18nService.t('mcpConnectTitle').replace('{name}', entry.name)}</DialogTitle>
              <DialogDescription className="mt-2 text-center">
                {i18nService.t('mcpConnectSubtitle')}
              </DialogDescription>
            </DialogHeader>

            <div className="mx-6 overflow-hidden rounded-xl border border-border bg-muted/40">
              <ConnectInfo icon={Plug} titleKey="mcpConnectUsageTitle" bodyKey="mcpConnectUsageBody" />
              <ConnectInfo icon={Database} titleKey="mcpConnectDataTitle" bodyKey="mcpConnectDataBody" />
              <ConnectInfo icon={Unplug} titleKey="mcpConnectControlTitle" bodyKey="mcpConnectControlBody" />
              <ConnectInfo icon={ShieldCheck} titleKey="mcpConnectAuthTitle" bodyKey="mcpConnectAuthBody" last />
            </div>

            <div className="p-6 pt-5">
              <Button className="w-full" onClick={onConnect} disabled={isConnecting}>
                {isConnecting ? i18nService.t('mcpConnecting') : i18nService.t('mcpConnect')}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ConnectInfo({
  icon: Icon,
  titleKey,
  bodyKey,
  last = false,
}: {
  icon: typeof Plug;
  titleKey: string;
  bodyKey: string;
  last?: boolean;
}) {
  return (
    <div className={`p-4 ${last ? '' : 'border-b border-border'}`}>
      <div className="flex gap-3">
        <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div>
          <p className="text-sm font-medium text-foreground">{i18nService.t(titleKey)}</p>
          <p className="mt-1 text-sm text-muted-foreground">{i18nService.t(bodyKey)}</p>
        </div>
      </div>
    </div>
  );
}
