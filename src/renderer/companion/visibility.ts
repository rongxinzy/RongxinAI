import type { CompanionWindowApi } from '../../shared/companion/types';

/** Subscribe before reading; a newer native notification wins over a late initial read. */
export function watchCompanionVisibility(
  api: Pick<CompanionWindowApi, 'visibility' | 'onVisibility'>,
  changed: (visible: boolean) => void,
  failed: () => void,
): () => void {
  let revision = 0;
  let disposed = false;
  const unsubscribe = api.onVisibility(visible => {
    if (disposed) return;
    revision++;
    changed(visible);
  });
  const initial = revision;
  void api.visibility().then(
    visible => {
      if (!disposed && revision === initial) changed(visible);
    },
    () => {
      if (!disposed && revision === initial) failed();
    },
  );
  return () => {
    disposed = true;
    unsubscribe();
  };
}
