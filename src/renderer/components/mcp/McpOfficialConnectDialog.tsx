import { Button } from '@shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@shared/components/ui/dialog';
import { Cable, Database, LoaderCircle, Plug, ShieldCheck, Unplug } from 'lucide-react';

import { i18nService } from '../../services/i18n';
import type { McpPresentationLocale, McpRegistryEntry } from '../../types/mcp';

interface McpOfficialConnectDialogProps {
  entry: McpRegistryEntry | null;
  iconSrc?: string;
  isConnecting: boolean;
  isFeishuCliReady?: boolean;
  isPreparing?: boolean;
  error?: string;
  onClose: () => void;
  onConnect: () => void;
  onPrepare?: () => void;
}

export function McpOfficialConnectDialog({
  entry,
  iconSrc,
  isConnecting,
  isFeishuCliReady = false,
  isPreparing = false,
  error,
  onClose,
  onConnect,
  onPrepare,
}: McpOfficialConnectDialogProps) {
  const isOpen = entry !== null;
  const locale = entry
    ? ((entry.presentation?.[i18nService.getLanguage() === 'zh' ? 'zh' : 'en'] ||
        entry.presentation?.en ||
        entry.presentation?.zh) as McpPresentationLocale | undefined)
    : undefined;
  const displayName = entry?.presentation?.name || entry?.name || '';
  const requiresExternalAccess = entry?.authType === 'external';
  const isFeishu = entry?.id === 'feishu';
  const title = isFeishu
    ? i18nService.t(isFeishuCliReady ? 'mcpFeishuLoginTitle' : 'mcpFeishuInstallTitle')
    : i18nService.t('mcpConnectTitle').replace('{name}', displayName);
  const subtitle = isFeishu ? i18nService.t('mcpFeishuSubtitle') : i18nService.t('mcpConnectSubtitle');
  const actionLabel = isFeishu
    ? isPreparing
      ? i18nService.t('mcpFeishuInstalling')
      : isFeishuCliReady
        ? isConnecting
          ? i18nService.t('mcpFeishuLoggingIn')
          : i18nService.t('mcpFeishuLogin')
        : i18nService.t('mcpFeishuInstall')
    : requiresExternalAccess
      ? i18nService.t('mcpExternalUnavailable')
      : isConnecting
        ? i18nService.t('mcpWaitingForAuthorization')
        : i18nService.t('mcpConnect');
  const isActionBusy = isConnecting || isPreparing;
  const handleAction = () => {
    if (isFeishu && !isFeishuCliReady) {
      onPrepare?.();
      return;
    }
    onConnect();
  };

  return (
    <Dialog open={isOpen} onOpenChange={open => !open && onClose()}>
      <DialogContent className="theme-control-sizing-4 max-w-[26rem] gap-0 overflow-hidden sm:max-w-[26rem]" showCloseButton>
        {entry && (
          <>
            <DialogHeader className="theme-control-sizing-25 items-center text-center">
              <div className="flex items-center">
                <div className="flex size-14 items-center justify-center overflow-hidden rounded-xl border border-border bg-card">
                  {iconSrc ? <img src={iconSrc} alt="" className="size-full object-contain" /> : <Cable className="size-8 text-foreground" />}
                </div>
              </div>
              <DialogTitle className="mt-4">
                {title}
              </DialogTitle>
              <DialogDescription className="mt-2 text-center">
                {subtitle}
              </DialogDescription>
            </DialogHeader>

            <div className="mx-4 overflow-hidden rounded-xl border border-border bg-muted/40">
              <ConnectInfo icon={Plug} titleKey="mcpConnectUsageTitle" bodyKey="mcpConnectUsageBody" section={locale?.connect?.usage} />
              <ConnectInfo icon={Database} titleKey="mcpConnectDataTitle" bodyKey="mcpConnectDataBody" section={locale?.connect?.data} />
              <ConnectInfo icon={Unplug} titleKey="mcpConnectControlTitle" bodyKey="mcpConnectControlBody" section={locale?.connect?.control} />
              <ConnectInfo icon={ShieldCheck} titleKey="mcpConnectAuthTitle" bodyKey="mcpConnectAuthBody" section={locale?.connect?.authorization} last />
            </div>

            <div className="p-4 pt-4">
              {error && <p className="mb-3 text-sm text-destructive">{error}</p>}
              <Button className="w-full" onClick={handleAction} disabled={isActionBusy || requiresExternalAccess}>
                {isActionBusy && <LoaderCircle className="size-4 animate-spin" />}
                {actionLabel}
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
  section,
  last = false,
}: {
  icon: typeof Plug;
  titleKey: string;
  bodyKey: string;
  section?: { title?: string; description?: string };
  last?: boolean;
}) {
  return (
    <div className={`p-3 ${last ? '' : 'border-b border-border'}`}>
      <div className="flex gap-3">
        <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div>
          <p className="text-sm font-medium text-foreground">{section?.title || i18nService.t(titleKey)}</p>
          <p className="mt-1 text-sm text-muted-foreground">{section?.description || i18nService.t(bodyKey)}</p>
        </div>
      </div>
    </div>
  );
}
