import { Button } from '@shared/components/ui/button';
import { ExternalLink } from 'lucide-react';
import React from 'react';
import { useDispatch } from 'react-redux';

import { i18nService } from '@/services/i18n';
import { selectArtifact } from '@/store/slices/artifactSlice';
import type { Artifact, ArtifactType } from '@/types/artifact';

const t = (key: string) => i18nService.t(key);

const GlobeIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="10" />
    <ellipse cx="12" cy="12" rx="4.5" ry="10" />
    <path d="M2 12h20" />
  </svg>
);

const SvgIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <circle cx="8.5" cy="8.5" r="1.5" />
    <path d="m21 15-5-5L5 21" />
  </svg>
);

const ImageIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <circle cx="8.5" cy="8.5" r="1.5" />
    <path d="m21 15-5-5L5 21" />
  </svg>
);

const MermaidIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="8.5" y="14" width="7" height="7" rx="1" />
    <path d="M6.5 10v1.5a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V10" />
    <path d="M12 12.5V14" />
  </svg>
);

const MarkdownIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <path d="M7 15V9l2.5 3L12 9v6" />
    <path d="M17 12l-2 3h4l-2-3z" />
  </svg>
);

const TextIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <line x1="8" y1="13" x2="16" y2="13" />
    <line x1="8" y1="17" x2="16" y2="17" />
  </svg>
);

const DocumentIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <polyline points="14 2 14 8 20 8" />
    <rect x="8" y="12" width="8" height="6" rx="1" />
  </svg>
);

const ModelIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M12 2.5 21 7.5v9L12 21.5 3 16.5v-9z" />
    <path d="M3 7.5 12 12.5l9-5" />
    <path d="M12 12.5v9" />
  </svg>
);

const TYPE_ICON_MAP: Record<ArtifactType, React.FC<{ className?: string }>> = {
  html: GlobeIcon,
  svg: SvgIcon,
  image: ImageIcon,
  mermaid: MermaidIcon,
  code: GlobeIcon,
  markdown: MarkdownIcon,
  text: TextIcon,
  document: DocumentIcon,
  model: ModelIcon,
  unsupported: DocumentIcon,
};

const TYPE_LABEL_KEY: Record<ArtifactType, string> = {
  html: 'artifactTypeHtml',
  svg: 'artifactTypeSvg',
  image: 'artifactTypeImage',
  mermaid: 'artifactTypeMermaid',
  code: 'artifactTypeHtml',
  markdown: 'artifactTypeMarkdown',
  text: 'artifactTypeText',
  document: 'artifactTypeDocument',
  model: 'artifactTypeModel',
  unsupported: 'artifactTypeUnsupported',
};

interface ArtifactPreviewCardProps {
  artifact: Artifact;
}

const ArtifactPreviewCard: React.FC<ArtifactPreviewCardProps> = ({ artifact }) => {
  const dispatch = useDispatch();

  const handleClick = () => {
    dispatch(selectArtifact(artifact.id));
  };

  const IconComponent = TYPE_ICON_MAP[artifact.type];
  const title = artifact.fileName || artifact.title;
  const subtitle = t(TYPE_LABEL_KEY[artifact.type]);

  return (
    <Button
      type="button"
      variant="outline"
      onClick={handleClick}
      className="theme-page-artifact-preview-card-button-1 flex items-center cursor-pointer max-w-sm w-full text-left"
    >
      <div className="shrink-0 w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center">
        <IconComponent className="w-5 h-5 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-foreground truncate">{title}</div>
        <div className="text-xs text-muted-foreground">{subtitle}</div>
      </div>
      <div className="shrink-0 flex items-center gap-1 text-primary text-sm font-medium">
        <ExternalLink className="w-4 h-4" />
        <span>{t('artifactOpen')}</span>
      </div>
    </Button>
  );
};

export default ArtifactPreviewCard;
