import { Button } from '@shared/components/ui/button';
import {
  Box,
  FileCode2,
  FileSpreadsheet,
  FileText,
  GitBranch,
  Globe,
  Image,
  Palette,
} from 'lucide-react';
import React from 'react';
import { useDispatch, useSelector } from 'react-redux';

import { i18nService } from '@/services/i18n';
import { selectArtifact, selectSelectedArtifact } from '@/store/slices/artifactSlice';
import type { Artifact, ArtifactType } from '@/types/artifact';

const TYPE_ICONS: Record<ArtifactType, React.ReactNode> = {
  html: <Globe className="size-4 shrink-0 text-muted-foreground" />,
  svg: <Palette className="size-4 shrink-0 text-muted-foreground" />,
  image: <Image className="size-4 shrink-0 text-muted-foreground" />,
  mermaid: <GitBranch className="size-4 shrink-0 text-muted-foreground" />,
  code: <FileCode2 className="size-4 shrink-0 text-muted-foreground" />,
  markdown: <FileText className="size-4 shrink-0 text-muted-foreground" />,
  text: <FileText className="size-4 shrink-0 text-muted-foreground" />,
  document: <FileSpreadsheet className="size-4 shrink-0 text-muted-foreground" />,
  model: <Box className="size-4 shrink-0 text-muted-foreground" />,
  unsupported: <FileText className="size-4 shrink-0 text-muted-foreground" />,
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
      aria-label={`${artifact.title} ${i18nService.t('artifactView')}`}
      aria-pressed={isSelected}
      className={`theme-page-artifact-badge-button-variant-3 inline-flex items-center cursor-pointer ${
        isSelected
          ? 'theme-page-artifact-badge-button-variant-1'
          : 'theme-page-artifact-badge-button-variant-2'
      }`}
    >
      {TYPE_ICONS[artifact.type] ?? TYPE_ICONS.text}
      <span className="max-w-[200px] truncate">{artifact.title}</span>
    </Button>
  );
};

export default ArtifactBadge;
