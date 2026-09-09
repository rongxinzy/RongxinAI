import { Alert, AlertTitle } from '@shared/components/ui/alert';
import { Button } from '@shared/components/ui/button';
import { Spinner } from '@shared/components/ui/spinner';
import { CheckCircle, QrCode, TriangleAlert } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useRef, useState } from 'react';

import { WeixinLoginErrorCode } from '@shared/ipc/channels';

import { i18nService } from '../../services/i18n';

type LoginState = 'idle' | 'loading' | 'showing' | 'scaned' | 'success' | 'error';

const WEIXIN_QR_POLL_RETRY_LIMIT = 2;
const WEIXIN_QR_POLL_INTERVAL_MS = 2_000;

function getWeixinLoginErrorMessage(errorCode?: WeixinLoginErrorCode): string {
  return i18nService.t(
    errorCode === WeixinLoginErrorCode.Transport ? 'imWeixinQrNetworkFailed' : 'imWeixinQrFailed',
  );
}

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
      setError(getWeixinLoginErrorMessage(result.errorCode));
      return;
    }
    setQrcodeUrl(result.qrcodeUrl);
    setState('showing');
    pollingRef.current = true;
    await pollLogin(result.qrcode);
  };

  const pollLogin = async (qrcode: string): Promise<void> => {
    let transportRetryCount = 0;
    while (pollingRef.current) {
      const result = await window.electron.im.weixinLoginPoll(qrcode);
      if (!pollingRef.current) return;
      if (!result.success) {
        if (
          result.errorCode === WeixinLoginErrorCode.Transport
          && transportRetryCount < WEIXIN_QR_POLL_RETRY_LIMIT
        ) {
          transportRetryCount += 1;
          await new Promise(resolve => setTimeout(resolve, WEIXIN_QR_POLL_INTERVAL_MS));
          continue;
        }
        setState('error');
        setError(getWeixinLoginErrorMessage(result.errorCode));
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
      await new Promise(resolve => setTimeout(resolve, WEIXIN_QR_POLL_INTERVAL_MS));
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
