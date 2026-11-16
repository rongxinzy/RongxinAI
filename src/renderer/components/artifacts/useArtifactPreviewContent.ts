import { useCallback, useEffect, useRef, useState } from 'react';
import { useDispatch } from 'react-redux';
import { addArtifact, ArtifactPanelView, setActiveTab } from '../../store/slices/artifactSlice';
import type { Artifact, ArtifactType } from '../../types/artifact';
import {
  invalidateArtifactFile,
  loadArtifactFileWithRetry,
} from '../../services/artifactFileLoader';
import { MAX_PREVIEW_HTML_CHARS } from './renderers/constants';

const PANEL_LOADED_ARTIFACT_TYPES = new Set<ArtifactType>([
  'mermaid',
  'svg',
  'code',
  'markdown',
  'text',
]);

interface Options {
  artifact: Artifact | null;
  cwd?: string | null;
  isCodeView: boolean;
  panelView: ArtifactPanelView;
}

/** Images stream through the controlled localfile protocol; never buffer them as base64 in Redux. */
export function useArtifactPreviewContent({ artifact, cwd, isCodeView, panelView }: Options) {
  const dispatch = useDispatch();
  const [loadingArtifactId, setLoadingArtifactId] = useState<string | null>(null);
  const [artifactLoadError, setArtifactLoadError] = useState<string | null>(null);
  const [imageRevision, setImageRevision] = useState(0);
  const currentArtifactId = useRef(artifact?.id);
  currentArtifactId.current = artifact?.id;
  const lastImageCreatedAtRef = useRef<{ id: string; createdAt: number } | null>(null);
  useEffect(() => {
    if (!artifact || artifact.type !== 'image' || !artifact.filePath) return;
    const prev = lastImageCreatedAtRef.current;
    if (prev && prev.id === artifact.id && prev.createdAt !== artifact.createdAt) {
      setImageRevision(value => value + 1);
    }
    lastImageCreatedAtRef.current = { id: artifact.id, createdAt: artifact.createdAt };
  }, [artifact]);
  useEffect(() => {
    if (
      panelView !== ArtifactPanelView.Preview ||
      !artifact ||
      artifact.content ||
      !artifact.filePath ||
      (!PANEL_LOADED_ARTIFACT_TYPES.has(artifact.type) && !(isCodeView && artifact.type === 'html'))
    ) {
      setLoadingArtifactId(null);
      setArtifactLoadError(null);
      return undefined;
    }

    let cancelled = false;
    const artifactId = artifact.id;
    setLoadingArtifactId(artifactId);
    setArtifactLoadError(null);

    loadArtifactFileWithRetry(artifact, cwd)
      .then(loaded => {
        if (cancelled) return;
        if (!loaded) {
          setArtifactLoadError(artifactId);
          return;
        }
        dispatch(
          addArtifact({
            sessionId: artifact.sessionId,
            artifact: { ...artifact, content: loaded.content, filePath: loaded.filePath },
          }),
        );
        // An oversized page has no usable preview: show its source instead of a
        // blank notice, so a saved web page can never take over the app.
        if (artifact.type === 'html' && loaded.content.length > MAX_PREVIEW_HTML_CHARS) {
          dispatch(setActiveTab('code'));
        }
      })
      .catch(() => {
        if (!cancelled) setArtifactLoadError(artifactId);
      })
      .finally(() => {
        if (!cancelled) setLoadingArtifactId(null);
      });

    return () => {
      cancelled = true;
    };
  }, [cwd, dispatch, isCodeView, panelView, artifact]);

  const handleRefresh = useCallback(async () => {
    if (!artifact?.filePath) return;
    if (artifact.type === 'image') {
      setImageRevision(value => value + 1);
      return;
    }
    const refreshId = artifact.id;
    invalidateArtifactFile(artifact.filePath);
    try {
      const loaded = await loadArtifactFileWithRetry({ ...artifact, content: '' }, cwd, {
        forceRefresh: true,
      });
      if (loaded && currentArtifactId.current === refreshId) {
        dispatch(
          addArtifact({
            sessionId: artifact.sessionId,
            artifact: { ...artifact, content: loaded.content, filePath: loaded.filePath },
          }),
        );
        // An oversized page has no usable preview: show its source instead of a
        // blank notice, so a saved web page can never take over the app.
        if (artifact.type === 'html' && loaded.content.length > MAX_PREVIEW_HTML_CHARS) {
          dispatch(setActiveTab('code'));
        }
      }
    } catch {
      // File unreadable or missing
    }
  }, [cwd, dispatch, artifact]);
  return { loadingArtifactId, artifactLoadError, imageRevision, handleRefresh };
}
