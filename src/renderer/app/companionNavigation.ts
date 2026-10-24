import { useEffect, type Dispatch, type SetStateAction } from 'react';
import { MainView } from './constants';

const MAIN_NAVIGATION_EVENT = 'app:companion-navigation';
type Destination = typeof MainView.Companion | typeof MainView.Cowork;

/** Feature navigation follows the shell's existing event-based entry points. */
export function requestCompanionNavigation(view: Destination): void {
  window.dispatchEvent(new CustomEvent(MAIN_NAVIGATION_EVENT, { detail: view }));
}

export function useCompanionNavigation(setView: Dispatch<SetStateAction<MainView>>): void {
  useEffect(() => {
    const navigate = (event: Event) => {
      const view: unknown = (event as CustomEvent<unknown>).detail;
      if (view === MainView.Companion || view === MainView.Cowork) setView(view);
    };
    window.addEventListener(MAIN_NAVIGATION_EVENT, navigate);
    const unsubscribe = window.electron.companion.onWorkbench(() => setView(MainView.Cowork));
    return () => {
      window.removeEventListener(MAIN_NAVIGATION_EVENT, navigate);
      unsubscribe();
    };
  }, [setView]);
}
