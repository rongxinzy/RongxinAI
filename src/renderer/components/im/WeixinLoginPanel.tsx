import { Alert, AlertTitle } from '@shared/components/ui/alert';
import { Button } from '@shared/components/ui/button';
import { Spinner } from '@shared/components/ui/spinner';
import { CheckCircle, QrCode, TriangleAlert } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useRef, useState } from 'react';

import { i18nService } from '../../services/i18n';

type LoginState = 'idle' | 'loading' | 'showing' | 'scaned' | 'success' | 'error';

export function WeixinLoginPanel({ onConfirmed }: { onConfirmed: () => Promise<void> }): React.JSX.Element {
  const [state, setState] = useState<LoginState>('idle');
  const [qrcodeUrl, setQrcodeUrl] = useState('');
  const [error, setError] = useState('');
  const pollingRef = useRef(false);

  useEffect(() => () => { pollingRef.current = false; }, []);

  const startLogin = async (): Promise<void> => {
    pollingRef.current = false;
    setState('loading');
    setError('');
    const result = await window.electron.im.weixinLoginStart();
    if (!result.success || !result.qrcode || !result.qrcodeUrl) {
      setState('error');
      setError(result.message || i18nService.t('imWeixinQrFailed'));
      return;
    }
    setQrcodeUrl(result.qrcodeUrl);
    setState('showing');
    pollingRef.current = true;
    await pollLogin(result.qrcode);
  };

  const pollLogin = async (qrcode: string): Promise<void> => {
    while (pollingRef.current) {
      const result = await window.electron.im.weixinLoginPoll(qrcode);
      if (!pollingRef.current) return;
      if (!result.success) {
        setState('error');
        setError(result.message || i18nService.t('imWeixinQrFailed'));
        pollingRef.current = false;
        return;
      }
      if (result.status === 'scaned') setState('scaned');
      if (result.status === 'expired') {
        setState('error');
        setError(i18nService.t('imWeixinQrExpired'));
        pollingRef.current = false;
        return;
      }
      if (result.status === 'confirmed') {
        setState('success');
        pollingRef.current = false;
        await onConfirmed();
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 2_000));
    }
  };

  return (
    <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border-subtle p-4 text-center">
      {(state === 'idle' || state === 'error') && (
        <>
          <Button type="button" onClick={() => void startLogin()}>
            <QrCode data-icon="inline-start" />
            {state === 'error' ? i18nService.t('imWeixinQrRefresh') : i18nService.t('imWeixinScanBtn')}
          </Button>
          <p className="text-xs text-muted-foreground">{i18nService.t('imWeixinScanHint')}</p>
        </>
      )}
      {state === 'loading' && (
        <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
          <Spinner />
          {i18nService.t('imWeixinQrLoading')}
        </div>
      )}
      {(state === 'showing' || state === 'scaned') && qrcodeUrl && (
        <>
          <p className="text-sm font-medium">
            {i18nService.t(state === 'scaned' ? 'imWeixinQrWaiting' : 'imWeixinQrScanPrompt')}
          </p>
          <div className="rounded-lg border border-border bg-white p-3">
            <QRCodeSVG value={qrcodeUrl} size={192} />
          </div>
        </>
      )}
      {state === 'success' && (
        <Alert>
          <CheckCircle />
          <AlertTitle>{i18nService.t('imWeixinQrSuccess')}</AlertTitle>
        </Alert>
      )}
      {state === 'error' && error && (
        <Alert variant="destructive">
          <TriangleAlert />
          <AlertTitle>{error}</AlertTitle>
        </Alert>
      )}
    </div>
  );
}
