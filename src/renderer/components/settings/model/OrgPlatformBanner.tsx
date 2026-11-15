import { Button } from '@shared/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@shared/components/ui/dialog';
import { Input } from '@shared/components/ui/input';
import { Label } from '@shared/components/ui/label';
import { Building2, RefreshCw, Unplug } from 'lucide-react';
import { useState } from 'react';
import type { AISphereSnapshot } from '../../../../shared/aisphere';
import { i18nService } from '../../../services/i18n';
import { showAppToast } from '../../../services/toastNotification';

export interface OrgPlatformBannerProps {
  snapshot: AISphereSnapshot;
  onRefresh: () => Promise<void>;
  onDisconnect: () => Promise<void>;
}

export function OrgPlatformBanner({ snapshot, onRefresh, onDisconnect }: OrgPlatformBannerProps) {
  const [busy, setBusy] = useState(false);

  if (!snapshot.address) return null;

  const host = (() => {
    try {
      return new URL(snapshot.address).host || snapshot.address;
    } catch {
      return snapshot.address;
    }
  })();

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-4 py-3">
      <div className="flex min-w-0 items-start gap-3">
        <span className="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-background text-foreground shadow-xs">
          <Building2 className="size-4" />
        </span>
        <div className="min-w-0">
          <div className="text-sm font-medium text-foreground">
            {i18nService.t('modelsOrgBannerTitle')}
          </div>
          <p className="text-xs text-muted-foreground">
            {i18nService.t('modelsOrgBannerDesc').replace('{host}', host)}
          </p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void onRefresh().finally(() => setBusy(false));
          }}
        >
          <RefreshCw className="size-3.5" />
          <span>{i18nService.t('modelsOrgBannerRefresh')}</span>
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="gap-1.5"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void onDisconnect().finally(() => setBusy(false));
          }}
        >
          <Unplug className="size-3.5" />
          <span>{i18nService.t('modelsOrgBannerDisconnect')}</span>
        </Button>
      </div>
    </div>
  );
}

export interface OrgPlatformConnectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialAddress?: string;
  onConnected: (snapshot: AISphereSnapshot) => void;
}

export function OrgPlatformConnectDialog({
  open,
  onOpenChange,
  initialAddress = '',
  onConnected,
}: OrgPlatformConnectDialogProps) {
  const [address, setAddress] = useState(initialAddress);
  const [connecting, setConnecting] = useState(false);

  const handleConnect = async () => {
    const trimmed = address.trim();
    if (!trimmed) return;
    setConnecting(true);
    try {
      const next = await window.electron.managedProviders.aisphereConnect(trimmed);
      onConnected(next);
      onOpenChange(false);
      showAppToast(i18nService.t('aisphereConnected'));
    } catch (error) {
      showAppToast({
        message: error instanceof Error ? error.message : i18nService.t('aisphereUnavailable'),
        isError: true,
      });
    } finally {
      setConnecting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{i18nService.t('aisphereTitle')}</DialogTitle>
          <DialogDescription>{i18nService.t('aisphereDescription')}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2 py-2">
          <Label htmlFor="org-platform-address">{i18nService.t('aisphereAddress')}</Label>
          <Input
            id="org-platform-address"
            value={address}
            placeholder={i18nService.t('aisphereAddressPlaceholder')}
            onChange={e => setAddress(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && address.trim() && !connecting) {
                e.preventDefault();
                void handleConnect();
              }
            }}
          />
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            {i18nService.t('cancel')}
          </Button>
          <Button
            type="button"
            disabled={!address.trim() || connecting}
            onClick={() => void handleConnect()}
          >
            {connecting ? i18nService.t('aisphereConnecting') : i18nService.t('aisphereConnect')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
