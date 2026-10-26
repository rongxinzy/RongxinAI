import { useEffect, useState } from 'react';
import { MainView } from './constants';

const KEEP_ALIVE_IDLE_MS = 10 * 60 * 1000;

/** Keep quick returns warm, then release the inactive renderer; runtime installation lives in main. */
export function useLocalInferenceVisibility(mainView: MainView) {
  const [hasMountedLocalInference, setHasMountedLocalInference] = useState(false);
  const [isLocalInferenceDormant, setIsLocalInferenceDormant] = useState(false);
  useEffect(() => {
    if (mainView === MainView.LocalInference) {
      setHasMountedLocalInference(true);
      setIsLocalInferenceDormant(false);
      return;
    }
    // Preserve fast navigation without retaining the hidden editor/model tree forever.
    if (!hasMountedLocalInference) return;
    const timer = window.setTimeout(() => setIsLocalInferenceDormant(true), KEEP_ALIVE_IDLE_MS);
    return () => window.clearTimeout(timer);
  }, [mainView, hasMountedLocalInference]);
  return { hasMountedLocalInference, isLocalInferenceDormant };
}
