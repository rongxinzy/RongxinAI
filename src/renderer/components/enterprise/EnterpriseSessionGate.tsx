import React, { useEffect, useRef, useState } from 'react';

import {
  EnterpriseRendererMessageSource,
  EnterpriseRendererMessageType,
  type EnterpriseRendererInitializeMessage,
  type EnterpriseRendererLanguage,
  type EnterpriseRendererSessionResponseMessage,
  type EnterpriseRendererTheme,
} from '../../../shared/enterpriseRenderer';
import type { EnterpriseSessionResult } from '../../../shared/enterpriseSession';
import {
  executeEnterpriseSessionRequest,
  isEnterpriseRendererReadyMessage,
  parseEnterpriseSessionRequest,
} from '../../services/enterpriseRenderer';
import WindowTitleBar from '../window/WindowTitleBar';

export const EnterpriseSessionGateState = {
  Checking: 'checking',
  Open: 'open',
  Passed: 'passed',
} as const;

type EnterpriseSessionGateState =
  (typeof EnterpriseSessionGateState)[keyof typeof EnterpriseSessionGateState];

interface EnterpriseSessionGateProps {
  readonly children: React.ReactNode;
}

interface GateContext {
  readonly entrypoint: string;
  readonly session: EnterpriseSessionResult;
}

export function EnterpriseSessionGate({ children }: EnterpriseSessionGateProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [state, setState] = useState<EnterpriseSessionGateState>(
    EnterpriseSessionGateState.Checking,
  );
  const [gateContext, setGateContext] = useState<GateContext | null>(null);

  useEffect(() => {
    let active = true;
    void Promise.all([
      window.electron.enterprise.renderer.sessionGateEntrypoint(),
      window.electron.enterprise.session.snapshot(),
    ])
      .then(([entrypoint, session]) => {
        if (!active) return;
        if (!entrypoint || canEnterApplication(session)) {
          setState(EnterpriseSessionGateState.Passed);
          return;
        }
        setGateContext({ entrypoint, session });
        setState(EnterpriseSessionGateState.Open);
      })
      .catch(() => {
        if (active) setState(EnterpriseSessionGateState.Passed);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (state !== EnterpriseSessionGateState.Open || !gateContext) return;

    const sendInitialization = () => {
      const target = iframeRef.current?.contentWindow;
      if (!target) return;
      const message: EnterpriseRendererInitializeMessage = {
        source: EnterpriseRendererMessageSource.Host,
        apiVersion: 1,
        type: EnterpriseRendererMessageType.Initialize,
        language: resolveLanguage(),
        theme: resolveTheme(),
        session: gateContext.session,
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

      void executeEnterpriseSessionRequest(request).then(result => {
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
        if (canEnterApplication(result)) setState(EnterpriseSessionGateState.Passed);
      });
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [gateContext, state]);

  if (state === EnterpriseSessionGateState.Passed) return children;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      {window.electron.platform === 'win32' ? (
        <div className="draggable relative h-9 shrink-0 bg-background">
          <WindowTitleBar isOverlayActive />
        </div>
      ) : null}
      {state === EnterpriseSessionGateState.Open && gateContext ? (
        <iframe
          ref={iframeRef}
          src={gateContext.entrypoint}
          title="Zhiyuan"
          sandbox="allow-scripts"
          className="min-h-0 flex-1 border-0 bg-background"
        />
      ) : (
        <div className="min-h-0 flex-1 bg-background" />
      )}
    </div>
  );
}

function canEnterApplication(result: EnterpriseSessionResult): boolean {
  if (!result.ok) return result.error.code === 'UNAVAILABLE';
  return (
    result.snapshot.status === 'unavailable' ||
    (result.snapshot.status === 'authenticated' && !result.snapshot.identity.passwordChangeRequired)
  );
}

function resolveLanguage(): EnterpriseRendererLanguage {
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

function resolveTheme(): EnterpriseRendererTheme {
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}
