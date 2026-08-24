import React, { useEffect, useState } from 'react';

import { EnterpriseRendererSurface } from '../../../shared/enterpriseRenderer';
import type { EnterpriseSessionResult } from '../../../shared/enterpriseSession';
import { subscribeToEnterpriseSession } from '../../services/enterpriseSessionEvents';
import { EnterpriseRendererFrame } from './EnterpriseRendererFrame';
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
        if (!entrypoint) {
          setState(EnterpriseSessionGateState.Passed);
          return;
        }
        setGateContext({ entrypoint, session });
        setState(
          canEnterApplication(session)
            ? EnterpriseSessionGateState.Passed
            : EnterpriseSessionGateState.Open,
        );
      })
      .catch(() => {
        if (active) setState(EnterpriseSessionGateState.Passed);
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const entrypoint = gateContext?.entrypoint;
    if (!entrypoint) return;
    return subscribeToEnterpriseSession(session => {
      setGateContext({ entrypoint, session });
      setState(
        canEnterApplication(session)
          ? EnterpriseSessionGateState.Passed
          : EnterpriseSessionGateState.Open,
      );
    });
  }, [gateContext?.entrypoint]);

  if (state === EnterpriseSessionGateState.Passed) return children;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background">
      {window.electron.platform === 'win32' ? (
        <div className="draggable relative h-9 shrink-0 bg-background">
          <WindowTitleBar isOverlayActive />
        </div>
      ) : null}
      {state === EnterpriseSessionGateState.Open && gateContext ? (
        <EnterpriseRendererFrame
          src={gateContext.entrypoint}
          title="Zhiyuan"
          surface={EnterpriseRendererSurface.SessionGate}
          session={gateContext.session}
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
