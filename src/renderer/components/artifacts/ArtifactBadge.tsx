import { Button } from '@shared/components/ui/button';
import React from 'react';
import { useDispatch, useSelector } from 'react-redux';

import { i18nService } from '@/services/i18n';
import { selectArtifact, selectSelectedArtifact } from '@/store/slices/artifactSlice';
import type { Artifact, ArtifactType } from '@/types/artifact';

const t = (key: string) => i18nService.t(key);

const TYPE_ICONS: Record<ArtifactType, string> = {
  html: '🌐',
  svg: '🎨',
  image: '🖼',
  mermaid: '📊',
  code: '📄',
  markdown: '📝',
  text: '📄',
  document: '📑',
};

interface ArtifactBadgeProps {
  artifact: Artifact;
}

const ArtifactBadge: React.FC<ArtifactBadgeProps> = ({ artifact }) => {
  const dispatch = useDispatch();
  const selected = useSelector(selectSelectedArtifact);
  const isSelected = selected?.id === artifact.id;

  const handleClick = () => {
    dispatch(selectArtifact(artifact.id));
  };

  return (
    <Button
      variant="outline"
      onClick={handleClick}
      className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-colors cursor-pointer h-auto
        ${
          isSelected
            ? 'border-primary bg-primary/10 text-primary hover:bg-primary/10 hover:text-primary'
            : 'border-border bg-surface hover:bg-surface-hover text-foreground'
        }`}
    >
      <span>{TYPE_ICONS[artifact.type] || '📄'}</span>
      <span className="truncate max-w-[200px]">{artifact.title}</span>
      <span className="text-xs text-muted">{t('artifactView')}</span>
    </Button>
  );
};

export default ArtifactBadge;
