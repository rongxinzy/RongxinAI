import { cn } from '@shared/lib/utils';
import { useEffect, useRef } from 'react';

import {
  EnterpriseRendererMessageSource,
  EnterpriseRendererMessageType,
  type EnterpriseRendererInitializeMessage,
  type EnterpriseRendererSessionResponseMessage,
  type EnterpriseRendererSurface,
} from '../../../shared/enterpriseRenderer';
import type { EnterpriseSessionResult } from '../../../shared/enterpriseSession';
import {
  executeEnterpriseSessionRequest,
  isEnterpriseRendererReadyMessage,
  parseEnterpriseSessionRequest,
} from '../../services/enterpriseRenderer';
import { publishEnterpriseSessionResult } from '../../services/enterpriseSessionEvents';

interface EnterpriseRendererFrameProps {
  readonly src: string;
  readonly title: string;
  readonly surface: EnterpriseRendererSurface;
  readonly session: EnterpriseSessionResult;
  readonly className?: string;
}

export function EnterpriseRendererFrame({
  src,
  title,
  surface,
  session,
  className,
}: EnterpriseRendererFrameProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const sendInitialization = () => {
      const target = iframeRef.current?.contentWindow;
      if (!target) return;
      const message: EnterpriseRendererInitializeMessage = {
        source: EnterpriseRendererMessageSource.Host,
        apiVersion: 1,
        type: EnterpriseRendererMessageType.Initialize,
        surface,
        language: resolveLanguage(),
        theme: resolveTheme(),
        session,
      };
      target.postMessage(message, '*');
    };

    const handleMessage = (event: MessageEvent<unknown>) => {
      if (event.source !== iframeRef.current?.contentWindow) return;
      if (isEnterpriseRendererReadyMessage(event.data)) {
        sendInitialization();
        return;
      }
      const request = parseEnterpriseSessionRequest(event.data);
      if (!request) return;

      void executeEnterpriseSessionRequest(request)
        .catch((): EnterpriseSessionResult => operationFailed())
        .then(result => {
          const target = iframeRef.current?.contentWindow;
          if (target) {
            const response: EnterpriseRendererSessionResponseMessage = {
              source: EnterpriseRendererMessageSource.Host,
              apiVersion: 1,
              type: EnterpriseRendererMessageType.SessionResponse,
              requestId: request.requestId,
              result,
            };
            target.postMessage(response, '*');
          }
          if (result.ok) publishEnterpriseSessionResult(result);
        });
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [session, surface]);

  return (
    <iframe
      ref={iframeRef}
      src={src}
      title={title}
      sandbox="allow-forms allow-scripts"
      className={cn('border-0 bg-background', className)}
    />
  );
}

function resolveLanguage(): EnterpriseRendererInitializeMessage['language'] {
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

function resolveTheme(): EnterpriseRendererInitializeMessage['theme'] {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

function operationFailed(): EnterpriseSessionResult {
  return {
    ok: false,
    error: { code: 'OPERATION_FAILED', message: 'Enterprise session operation failed.' },
  };
}
