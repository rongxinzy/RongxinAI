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
import { Eye, EyeOff, ExternalLink, LoaderCircle } from 'lucide-react';
import { useState } from 'react';

import { i18nService } from '../../services/i18n';
import type { McpRegistryEntry } from '../../types/mcp';

interface McpTokenConnectDialogProps {
  entry: McpRegistryEntry | null;
  isSaving: boolean;
  error?: string;
  onClose: () => void;
  onSave: (token: string) => void;
}

export function McpTokenConnectDialog({ entry, isSaving, error, onClose, onSave }: McpTokenConnectDialogProps) {
  const [token, setToken] = useState('');
  const [visible, setVisible] = useState(false);
  const isOpen = entry !== null;
  const name = entry?.presentation?.name || entry?.name || '';
  const tokenInputId = `${entry?.id || 'mcp'}-access-token`;
  const isBaiduNetdisk = entry?.id === 'baidu-netdisk';
  const descriptionKey = isBaiduNetdisk ? 'mcpBaiduConfigureSubtitle' : 'mcpGithubConfigureSubtitle';
  const labelKey = isBaiduNetdisk ? 'mcpBaiduAccessToken' : 'mcpGithubPat';
  const placeholderKey = isBaiduNetdisk ? 'mcpBaiduAccessTokenPlaceholder' : 'mcpGithubPatPlaceholder';
  const hintKey = isBaiduNetdisk ? 'mcpBaiduAccessTokenHint' : 'mcpGithubPatHint';
  const linkKey = isBaiduNetdisk ? 'mcpBaiduAccessTokenLink' : 'mcpGithubPatLink';
  const documentationUrl = isBaiduNetdisk
    ? 'https://pan.baidu.com/union/doc/Wm9sl0i0j'
    : 'https://github.com/settings/personal-access-tokens/new';

  const close = (open: boolean) => {
    if (!open && !isSaving) onClose();
  };

  return (
    <Dialog open={isOpen} onOpenChange={close}>
      <DialogContent className="sm:max-w-lg">
        {entry && (
          <>
            <DialogHeader>
              <DialogTitle>{i18nService.t('mcpConfigureTitle').replace('{name}', name)}</DialogTitle>
              <DialogDescription>{i18nService.t(descriptionKey)}</DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <label className="text-sm font-medium text-foreground" htmlFor={tokenInputId}>
                {i18nService.t(labelKey)}<span className="text-destructive"> *</span>
              </label>
              <p className="text-sm leading-5 text-muted-foreground">
                {i18nService.t(hintKey)}{' '}
                <a className="inline-flex items-center gap-1 text-primary hover:underline" href={documentationUrl} target="_blank" rel="noreferrer">
                  {i18nService.t(linkKey)}<ExternalLink className="size-3" />
                </a>
              </p>
              <div className="relative">
                <Input
                  id={tokenInputId}
                  className="theme-control-sizing-26"
                  type={visible ? 'text' : 'password'}
                  value={token}
                  onChange={event => setToken(event.target.value)}
                  placeholder={i18nService.t(placeholderKey)}
                  disabled={isSaving}
                  autoFocus
                />
                <Button type="button" variant="ghost" size="icon" className="absolute right-1 top-1/2 size-8 -translate-y-1/2" onClick={() => setVisible(value => !value)} aria-label={i18nService.t(visible ? 'mcpHideAccessToken' : 'mcpShowAccessToken')}>
                  {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </Button>
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose} disabled={isSaving}>{i18nService.t('cancel')}</Button>
              <Button type="button" onClick={() => onSave(token.trim())} disabled={!token.trim() || isSaving}>
                {isSaving && <LoaderCircle className="size-4 animate-spin" />}{i18nService.t('mcpSaveAndEnable')}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
