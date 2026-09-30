import { useEffect, useState } from 'react';

import { CodingUiEvent } from './constants';

/** Keep the sidebar entry connected to the existing workbench manager dialog. */
export function useCodingAgentManager() {
  const state = useState(false);
  const [, setOpen] = state;
  useEffect(() => {
    const open = () => setOpen(true);
    window.addEventListener(CodingUiEvent.ManageAgents, open);
    return () => window.removeEventListener(CodingUiEvent.ManageAgents, open);
  }, [setOpen]);
  return state;
}
