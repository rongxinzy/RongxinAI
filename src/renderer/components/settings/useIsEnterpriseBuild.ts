import { useEffect, useState } from 'react';

/**
 * Mirrors the main-process build-flavor detection (`isEnterpriseBuild`) so
 * enterprise surfaces can hide community-only entries. The main process owns
 * the determination; the renderer only reads it through `appInfo`. Preload
 * may lag behind Vite HMR after adding a bridge method, so a missing or
 * failing bridge reads as community instead of crashing.
 */
export function useIsEnterpriseBuild(): boolean {
  const [isEnterpriseBuild, setIsEnterpriseBuild] = useState(false);

  useEffect(() => {
    const isEnterprise = window.electron.appInfo.isEnterprise;
    if (typeof isEnterprise !== 'function') return;
    let active = true;
    void isEnterprise()
      .then(value => {
        if (active) setIsEnterpriseBuild(value === true);
      })
      .catch(() => {
        if (active) setIsEnterpriseBuild(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return isEnterpriseBuild;
}
