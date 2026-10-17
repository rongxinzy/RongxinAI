import React, { useEffect, useRef } from 'react';
import { useDispatch } from 'react-redux';

import { resolveArtifactPath } from '../../../../shared/cowork/artifactPath';
import { openAvailableArtifact } from '../../../services/artifactAvailability';
import {
  getArtifactTypeFromExtension,
  normalizeFilePathForDedup,
} from '../../../services/artifactParser';
import { selectArtifact } from '../../../store/slices/artifactSlice';
import type { Artifact } from '../../../types/artifact';

interface UseArtifactLinkInterceptionOptions {
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  sessionId: string | undefined;
  sessionArtifacts: Artifact[];
  cwd: string | undefined;
}

/**
 * Intercept clicks on artifact-compatible file links inside the conversation
 * and open the matching artifact in the panel instead of the browser.
 */
export const useArtifactLinkInterception = ({
  scrollContainerRef,
  sessionId,
  sessionArtifacts,
  cwd,
}: UseArtifactLinkInterceptionOptions): void => {
  const dispatch = useDispatch();

  // The session the registered document listeners belong to. A link probe that
  // settles after a session switch (or after unmount) must not change the
  // selection of a session the user has already left.
  const artifactListenerSessionIdRef = useRef<string | null>(sessionId ?? null);
  useEffect(() => {
    artifactListenerSessionIdRef.current = sessionId ?? null;
    return () => {
      artifactListenerSessionIdRef.current = null;
    };
  }, [sessionId]);

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || !sessionId) return;

    const handleLinkClick = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement).closest('a');
      if (!anchor) return;

      const href = anchor.getAttribute('href') || '';
      if (!href.startsWith('file://')) return;

      const filePath = resolveArtifactPath(href);

      const lastDot = filePath.lastIndexOf('.');
      if (lastDot === -1) return;
      const ext = filePath.slice(lastDot).toLowerCase();
      if (!getArtifactTypeFromExtension(ext)) return;

      e.preventDefault();
      e.stopPropagation();

      const normalizedClick = normalizeFilePathForDedup(filePath);
      const existing = sessionArtifacts.find(
        a => a.filePath && normalizeFilePathForDedup(a.filePath) === normalizedClick,
      );
      if (existing) {
        // The probe may settle after the user switched sessions; only a verdict for
        // the session that registered this listener may change the selection.
        void openAvailableArtifact(existing, () => dispatch(selectArtifact(existing.id)), cwd, {
          isCurrent: () => artifactListenerSessionIdRef.current === sessionId,
        });
      }
      // No fallback creation — artifacts are now declared via declare_artifact tool,
      // not created from ad-hoc link clicks or regex parsing.
    };

    container.addEventListener('click', handleLinkClick, true);
    return () => container.removeEventListener('click', handleLinkClick, true);
  }, [sessionId, sessionArtifacts, dispatch, cwd, scrollContainerRef]);
};
