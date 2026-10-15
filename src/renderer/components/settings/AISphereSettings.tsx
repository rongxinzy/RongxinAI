import { useEffect, useState } from 'react';
import { Button } from '@shared/components/ui/button';
import { Input } from '@shared/components/ui/input';
import { Label } from '@shared/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@shared/components/ui/select';
import {
  AISphere,
  AISphereError,
  AISphereStatus,
  type AISphereSnapshot,
} from '../../../shared/aisphere';
import { configService } from '../../services/config';
import { i18nService } from '../../services/i18n';

export function AISphereSettings() {
  const [snapshot, setSnapshot] = useState<AISphereSnapshot>();
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState(configService.getConfig().model.defaultModel ?? '');
  const t = (key: string) => i18nService.t(key);

  useEffect(() => {
    let disposed = false;
    void window.electron.managedProviders
      ?.aisphereSnapshot?.()
      ?.then(value => {
        if (!disposed && value) {
          setSnapshot(value);
          setAddress(value.address);
        }
      })
      ?.catch(() => {
        if (!disposed) setError(AISphereError.Unavailable);
      });
    return () => {
      disposed = true;
    };
  }, []);

  const connect = async (refresh: boolean) => {
    setBusy(true);
    setError('');
    try {
      const value = refresh
        ? await window.electron.managedProviders.aisphereRefresh()
        : await window.electron.managedProviders.aisphereConnect(address);
      setSnapshot(value);
      setAddress(value.address);
      const config = await configService.reload();
      setSelected(config.model.defaultModel ?? '');
      window.dispatchEvent(new CustomEvent('config-updated'));
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '';
      setError(
        Object.values(AISphereError).find(code => message.includes(code)) ??
          AISphereError.Unavailable,
      );
      setSnapshot(await window.electron.managedProviders.aisphereSnapshot().catch(() => undefined));
    } finally {
      setBusy(false);
    }
  };

  const choose = async (value: string | null) => {
    if (!value) return;
    setBusy(true);
    setError('');
    try {
      await configService.updateConfig({
        model: {
          ...configService.getConfig().model,
          defaultModel: value,
          defaultModelProvider: AISphere.Provider,
        },
      });
      setSelected(value);
    } catch {
      setError(AISphereError.Unavailable);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-xl space-y-6 p-4">
      <div className="space-y-2">
        <Label htmlFor="aisphere-address">{t('aisphereAddress')}</Label>
        <Input
          id="aisphere-address"
          value={address}
          onChange={event => setAddress(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter') {
              event.preventDefault();
              if (!busy && address.trim()) void connect(false);
            }
          }}
          placeholder={t('aisphereAddressPlaceholder')}
          disabled={busy}
          autoComplete="off"
        />
        <p className="text-sm text-muted-foreground">{t('aisphereDescription')}</p>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            onClick={() => void connect(false)}
            disabled={busy || !address.trim()}
          >
            {t(busy ? 'aisphereConnecting' : 'aisphereConnect')}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => void connect(true)}
            disabled={busy || !snapshot?.address}
          >
            {t('aisphereRefresh')}
          </Button>
        </div>
      </div>
      <p role="status" className="text-sm text-muted-foreground">
        {t(
          snapshot?.status === AISphereStatus.Ready
            ? 'aisphereConnected'
            : snapshot?.status === AISphereStatus.Unavailable
              ? AISphereError.Unavailable
              : 'aisphereUnconfigured',
        )}
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {t(error)}
        </p>
      )}
      <div className="space-y-2">
        <Label id="aisphere-model-label">{t('aisphereDefaultModel')}</Label>
        <Select
          value={snapshot?.models.some(model => model.id === selected) ? selected : null}
          onValueChange={value => void choose(value)}
          disabled={busy || snapshot?.status !== AISphereStatus.Ready || !snapshot.models.length}
        >
          <SelectTrigger className="w-full" aria-labelledby="aisphere-model-label">
            <SelectValue placeholder={t('aisphereSelectModel')} />
          </SelectTrigger>
          <SelectContent>
            {snapshot?.models.map(model => (
              <SelectItem key={model.id} value={model.id}>
                {model.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {snapshot?.status === AISphereStatus.Ready && snapshot.models.length === 0 && (
          <p className="text-sm text-muted-foreground">{t('aisphereNoModels')}</p>
        )}
      </div>
    </div>
  );
}
