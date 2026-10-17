import { useEffect, useState } from 'react';

import type {
  CodingAgentAvailableCommand,
  CodingAgentConfigOption,
} from '../../../shared/codingAgent';
import { CodingAgentDriverKind } from '../../../shared/codingAgent';

interface UseCodingDraftSessionControlsOptions {
  draftSessionId: string | undefined;
  draftProfileId: string | null;
  activeDriverKind: (typeof CodingAgentDriverKind)[keyof typeof CodingAgentDriverKind] | null;
}

/**
 * A draft has no lane yet, so this projects the profile's default config
 * options and slash commands to show model/thinking controls before the
 * session exists, plus locally tracked option overrides.
 */
export function useCodingDraftSessionControls({
  draftSessionId,
  draftProfileId,
  activeDriverKind,
}: UseCodingDraftSessionControlsOptions) {
  const [draftConfigOptions, setDraftConfigOptions] = useState<CodingAgentConfigOption[]>([]);
  const [draftAvailableCommands, setDraftAvailableCommands] = useState<
    CodingAgentAvailableCommand[]
  >([]);
  const [draftConfigOverrides, setDraftConfigOverrides] = useState<Record<string, string>>({});
  useEffect(() => {
    setDraftConfigOverrides({});
    if (!draftProfileId || activeDriverKind !== CodingAgentDriverKind.Builtin) {
      setDraftConfigOptions([]);
      return;
    }
    let cancelled = false;
    void window.electron.codingAgent
      .getProfileConfigOptions(draftProfileId)
      .then(result => {
        if (!cancelled && result.success) setDraftConfigOptions(result.configOptions ?? []);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [activeDriverKind, draftProfileId, draftSessionId]);
  // A draft has no driver session yet, so the lane snapshot carries no commands
  // and the slash menu would stay empty until the first turn creates a lane.
  // Project the profile defaults instead, exactly like the config options above.
  useEffect(() => {
    if (!draftProfileId || activeDriverKind !== CodingAgentDriverKind.Builtin) {
      setDraftAvailableCommands([]);
      return;
    }
    let cancelled = false;
    void window.electron.codingAgent
      .getProfileAvailableCommands(draftProfileId)
      .then(result => {
        if (!cancelled && result.success) setDraftAvailableCommands(result.commands ?? []);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [activeDriverKind, draftProfileId, draftSessionId]);
  return {
    draftAvailableCommands,
    draftConfigOptions,
    draftConfigOverrides,
    setDraftConfigOptions,
    setDraftConfigOverrides,
  };
}
