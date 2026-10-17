import { Button } from '@shared/components/ui/button';
import { Input } from '@shared/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shared/components/ui/select';
import { Switch } from '@shared/components/ui/switch';
import { useEffect, useState } from 'react';

import type {
  MagpiePreferences,
  MagpiePreferencesPatch,
} from '../../../../shared/magpie/preferences';
import { i18nService } from '../../../services/i18n';
import { MagpiePreferenceRow } from './MagpiePreferenceControls';

const PROXY_AUTO = 'auto';
const PROXY_DIRECT = 'direct';
const PROXY_CUSTOM = 'custom';

export function MagpieNetworkPreferences({
  preferences,
  saving,
  update,
}: {
  preferences: MagpiePreferences;
  saving: boolean;
  update: (patch: MagpiePreferencesPatch) => Promise<boolean>;
}) {
  const currentMode = !preferences.proxy
    ? PROXY_AUTO
    : preferences.proxy === 'direct'
      ? PROXY_DIRECT
      : PROXY_CUSTOM;
  const [mode, setMode] = useState(currentMode);
  const [address, setAddress] = useState(currentMode === PROXY_CUSTOM ? preferences.proxy : '');
  useEffect(() => {
    setMode(currentMode);
    setAddress(currentMode === PROXY_CUSTOM ? preferences.proxy : '');
  }, [currentMode, preferences.proxy]);
  const proxyDescription = (() => {
    switch (preferences.proxySource) {
      case 'settings':
        return i18nService
          .t('magpieProxyUsingCustom')
          .replace('{proxy}', preferences.proxyNow || '—');
      case 'system':
        return i18nService
          .t('magpieProxyUsingSystem')
          .replace('{proxy}', preferences.proxyNow || '—');
      case 'environment':
        return i18nService
          .t('magpieProxyUsingEnvironment')
          .replace('{proxy}', preferences.proxyNow || '—');
      case 'off':
        return i18nService.t('magpieProxyOffHint');
      default:
        return i18nService.t('magpieProxyNoneHint');
    }
  })();
  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-4">
        <h2 className="text-base font-semibold">{i18nService.t('magpieNetworkGateway')}</h2>
        <MagpiePreferenceRow
          title={i18nService.t('magpieProxyTitle')}
          description={proxyDescription}
          control={
            <Select
              items={{
                [PROXY_AUTO]: i18nService.t('magpieProxyAuto'),
                [PROXY_DIRECT]: i18nService.t('magpieProxyDirect'),
                [PROXY_CUSTOM]: i18nService.t('magpieProxyCustom'),
              }}
              value={mode}
              disabled={saving}
              onValueChange={next => {
                if (!next) return;
                setMode(next);
                if (next === PROXY_AUTO) void update({ proxy: '' });
                else if (next === PROXY_DIRECT) void update({ proxy: 'direct' });
              }}
            >
              <SelectTrigger
                className="w-full lg:w-48"
                aria-label={i18nService.t('magpieProxyTitle')}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={PROXY_AUTO}>{i18nService.t('magpieProxyAuto')}</SelectItem>
                <SelectItem value={PROXY_DIRECT}>{i18nService.t('magpieProxyDirect')}</SelectItem>
                <SelectItem value={PROXY_CUSTOM}>{i18nService.t('magpieProxyCustom')}</SelectItem>
              </SelectContent>
            </Select>
          }
        />
        {mode === PROXY_CUSTOM ? (
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
            <Input
              className="w-full font-mono text-sm lg:w-80"
              value={address}
              placeholder="http://127.0.0.1:7890"
              aria-label={i18nService.t('magpieProxyAddress')}
              disabled={saving}
              onChange={event => setAddress(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  void update({ proxy: address.trim() });
                }
              }}
            />
            <Button
              type="button"
              variant="outline"
              disabled={saving || !address.trim()}
              onClick={() => void update({ proxy: address.trim() })}
            >
              {i18nService.t('magpieApply')}
            </Button>
          </div>
        ) : null}
        <MagpiePreferenceRow
          title={i18nService.t('magpieBareIds')}
          description={i18nService.t('magpieBareIdsHint')}
          control={
            <Switch
              aria-label={i18nService.t('magpieBareIds')}
              checked={preferences.bareModelIDs}
              disabled={saving}
              onCheckedChange={bareModelIDs => void update({ bareModelIDs })}
            />
          }
        />
      </section>

      <section className="flex flex-col gap-4 border-t border-border pt-6">
        <h2 className="text-base font-semibold">{i18nService.t('magpieGatewayInfo')}</h2>
        <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">{i18nService.t('magpieGatewayAddress')}</dt>
            <dd className="break-all">{preferences.gateway || '—'}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{i18nService.t('magpieGatewayPort')}</dt>
            <dd>{preferences.portEnv || preferences.port || '—'}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{i18nService.t('magpieGatewaySharing')}</dt>
            <dd>
              {preferences.lan || preferences.onNetwork
                ? i18nService.t('magpieGatewaySharingOn')
                : i18nService.t('magpieGatewaySharingOff')}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{i18nService.t('magpieGatewayPublicUrl')}</dt>
            <dd className="break-all">{preferences.publicUrl || '—'}</dd>
          </div>
        </dl>
        {preferences.lan && preferences.lanUrls.length > 0 ? (
          <div className="flex flex-col gap-1">
            <p className="text-sm text-muted-foreground">
              {i18nService.t('magpieGatewayLanAddresses')}
            </p>
            <ul className="flex flex-col gap-0.5">
              {preferences.lanUrls.map(url => (
                <li key={url} className="break-all font-mono text-sm">
                  {url}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        <p className="text-sm text-muted-foreground">{i18nService.t('magpieNetworkHostManaged')}</p>
      </section>
    </div>
  );
}
