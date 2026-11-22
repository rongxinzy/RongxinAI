import { useEffect, type Dispatch, type SetStateAction } from 'react';
import { MainView } from './constants';

export function useCompanionNavigation(setView: Dispatch<SetStateAction<MainView>>): void {
  useEffect(() => window.electron.companion.onWorkbench(() => setView(MainView.Cowork)), [setView]);
}
