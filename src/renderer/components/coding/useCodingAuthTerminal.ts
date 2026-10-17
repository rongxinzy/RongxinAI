import { useEffect, useState } from 'react';

import { showAppToast } from '../../services/appToast';
import { i18nService } from '../../services/i18n';

export interface CodingAuthTerminalState {
  id: string;
  profileId: string;
  output: string;
}

/**
 * Tracks the interactive terminal an agent opens to complete authentication:
 * streamed output accumulates here and a non-zero exit closes it with a toast.
 */
export function useCodingAuthTerminal() {
  const [authTerminal, setAuthTerminal] = useState<CodingAuthTerminalState | null>(null);
  const [authTerminalInput, setAuthTerminalInput] = useState('');

  useEffect(() => {
    const removeData = window.electron.codingAgent.onAuthTerminalData(event => {
      setAuthTerminal(current =>
        current?.id === event.id
          ? { ...current, output: `${current.output}${event.data}` }
          : current,
      );
    });
    const removeExit = window.electron.codingAgent.onAuthTerminalExit(event => {
      setAuthTerminal(current => (current?.id === event.id ? null : current));
      if (event.exitCode !== 0)
        showAppToast(i18nService.t('codingAgentTerminalAuthenticationFailed'), { isError: true });
    });
    return () => {
      removeData();
      removeExit();
    };
  }, []);

  const submitAuthTerminalInput = () => {
    if (!authTerminal) return;
    void window.electron.codingAgent.writeAuthTerminal({
      id: authTerminal.id,
      data: `${authTerminalInput}\r`,
    });
    setAuthTerminalInput('');
  };

  return {
    authTerminal,
    authTerminalInput,
    setAuthTerminalInput,
    submitAuthTerminalInput,
  };
}
