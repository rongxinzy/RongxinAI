import { Button } from '@shared/components/ui/button';
import { resolveArtifactPath } from '@shared/cowork/artifactPath';
import { FileText, FolderOpen } from 'lucide-react';
import {
  Attachment,
  AttachmentInfo,
  Attachments,
} from '@shared/components/ai-elements/attachments';
import { Spinner } from '@shared/components/ui/spinner';
import React, { useEffect, useRef, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { showAppErrorToast } from '@/services/toastNotification';

import {
  ArtifactFileAvailability,
  probeArtifactFileAvailability,
} from '@/services/artifactAvailability';
import { i18nService } from '@/services/i18n';
import { selectCurrentSession } from '@/store/selectors/coworkSelectors';
import {
  closePanel,
  selectArtifact,
  selectIsPanelOpen,
  selectSelectedArtifact,
} from '@/store/slices/artifactSlice';
import type { Artifact } from '@/types/artifact';

const t = (key: string) => i18nService.t(key);

interface ArtifactPreviewCardProps {
  artifact: Artifact;
  disabled?: boolean;
}

const ArtifactPreviewCard: React.FC<ArtifactPreviewCardProps> = ({
  artifact,
  disabled = false,
}) => {
  const dispatch = useDispatch();
  const isPanelOpen = useSelector(selectIsPanelOpen);
  const selectedArtifact = useSelector(selectSelectedArtifact);
  const currentSession = useSelector(selectCurrentSession);
  const cwd = currentSession?.id === artifact.sessionId ? currentSession.cwd : undefined;
  const [checking, setChecking] = useState(false);
  const busy = checking;

  // An availability answer belongs to one card identity inside one session. Any
  // change to that identity — or unmounting the card — invalidates the pending
  // probe, so a late answer cannot select an artifact the user has already left.
  const probeGenerationRef = useRef(0);
  useEffect(() => {
    probeGenerationRef.current += 1;
  }, [artifact.id, artifact.filePath, artifact.sessionId, currentSession?.id]);
  useEffect(
    () => () => {
      probeGenerationRef.current += 1;
    },
    [],
  );

  // 2026/09/20 lixiang  右侧预览面板 toggle：同文件已打开则关闭，否则打开/切换（issue #805）
  const handleOpenPreview = async () => {
    if (disabled || busy) return;
    if (isPanelOpen && selectedArtifact?.id === artifact.id) {
      dispatch(closePanel());
      return;
    }
    probeGenerationRef.current += 1;
    const probeGeneration = probeGenerationRef.current;
    setChecking(true);
    try {
      const state = await probeArtifactFileAvailability(artifact, cwd);
      if (probeGeneration !== probeGenerationRef.current) return;
      if (state === ArtifactFileAvailability.Missing) {
        showAppErrorToast(t('fileNotFound'));
        return;
      }
      dispatch(selectArtifact(artifact.id));
    } finally {
      setChecking(false);
    }
  };

  // The folder action is a sibling button so keyboard navigation has no nested controls.
  const handleOpenLocalFolder = async (event: React.MouseEvent | React.KeyboardEvent) => {
    const path = artifact.filePath?.trim();
    if (!path) return;
    event.preventDefault();
    event.stopPropagation();
    probeGenerationRef.current += 1;
    const probeGeneration = probeGenerationRef.current;
    try {
      const state = await probeArtifactFileAvailability(artifact, cwd);
      if (probeGeneration !== probeGenerationRef.current) return;
      if (state === ArtifactFileAvailability.Missing) {
        showAppErrorToast(t('fileNotFound'));
        return;
      }
      const result = await window.electron.shell.showItemInFolder(resolveArtifactPath(path, cwd));
      if (!result?.success) {
        console.error('[Artifact] Failed to show item in folder:', path, result?.error);
      }
    } catch (error) {
      console.error('[Artifact] Failed to show item in folder:', path, error);
    }
  };

  const title = artifact.fileName || artifact.title;
  const localPath = artifact.filePath?.trim() || '';

  return (
    <Attachments variant="inline" className="max-w-full">
      <Attachment
        data={{
          type: 'source-document',
          id: artifact.id,
          sourceId: artifact.id,
          title,
          filename: title,
          mediaType: 'application/octet-stream',
        }}
      >
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled || busy}
          onClick={handleOpenPreview}
          aria-busy={busy}
          aria-label={title + ' ' + t('artifactOpen')}
          className="min-w-0 flex-1 justify-start gap-2"
        >
          <FileText data-icon="inline-start" />
          <AttachmentInfo />
          {busy && <Spinner aria-label={t('artifactOpen')} />}
        </Button>
        {localPath && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={disabled || busy}
            onClick={handleOpenLocalFolder}
            title={t('artifactOpenFolder')}
            aria-label={t('artifactOpenFolder')}
          >
            <FolderOpen />
          </Button>
        )}
      </Attachment>
    </Attachments>
  );
};

export default ArtifactPreviewCard;
