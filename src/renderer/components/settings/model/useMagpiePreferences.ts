import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  MagpiePreferences,
  MagpiePreferencesPatch,
} from '../../../../shared/magpie/preferences';
import { showAppError } from '../../../services/appToast';
import { i18nService } from '../../../services/i18n';

export function useMagpiePreferences(enabled: boolean) {
  const [preferences, setPreferences] = useState<MagpiePreferences | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(false);
  const savingRef = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    if (!enabled) {
      setPreferences(null);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const next = await window.electron.magpie.preferences();
      if (mounted.current) setPreferences(next);
    } catch (err: unknown) {
      if (!mounted.current) return;
      setError(i18nService.t('magpiePreferencesLoadFailed'));
      console.error('[Magpie] Failed to load preferences:', err);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [enabled]);

  useEffect(() => {
    void load();
  }, [load]);

  const update = useCallback(async (patch: MagpiePreferencesPatch) => {
    if (savingRef.current) return false;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const next = await window.electron.magpie.updatePreferences(patch);
      if (mounted.current) setPreferences(next);
      return true;
    } catch (err: unknown) {
      if (!mounted.current) return false;
      setError(i18nService.t('magpiePreferencesSaveFailed'));
      showAppError(err instanceof Error ? err.message : i18nService.t('magpieActionFailed'));
      return false;
    } finally {
      savingRef.current = false;
      if (mounted.current) setSaving(false);
    }
  }, []);

  return { preferences, loading, saving, error, reload: load, update };
}
