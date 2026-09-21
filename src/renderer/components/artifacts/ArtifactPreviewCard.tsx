import { Button } from '@shared/components/ui/button';
import { ExternalLink } from 'lucide-react';
import React from 'react';
import { useDispatch, useSelector } from 'react-redux';

import { i18nService } from '@/services/i18n';
import {
  closePanel,
  selectArtifact,
  selectIsPanelOpen,
  selectSelectedArtifact,
} from '@/store/slices/artifactSlice';
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
  const isPanelOpen = useSelector(selectIsPanelOpen);
  const selectedArtifact = useSelector(selectSelectedArtifact);

  // 2026/09/20 lixiang  右侧预览面板 toggle：同文件已打开则关闭，否则打开/切换（issue #805）
  const handleOpenPreview = () => {
    if (isPanelOpen && selectedArtifact?.id === artifact.id) {
      dispatch(closePanel());
      return;
    }
    dispatch(selectArtifact(artifact.id));
  };

  // 2026/09/20 lixiang  仅文件名打开所在文件夹；阻止冒泡，避免触发整卡预览 toggle（issue #805）
  const handleOpenLocalFolder = async (
    event: React.MouseEvent | React.KeyboardEvent,
  ) => {
    const path = artifact.filePath?.trim();
    if (!path) return;
    event.preventDefault();
    event.stopPropagation();
    try {
      const result = await window.electron.shell.showItemInFolder(path);
      if (!result?.success) {
        console.error('[Artifact] Failed to show item in folder:', path, result?.error);
      }
    } catch (error) {
      console.error('[Artifact] Failed to show item in folder:', path, error);
    }
  };

  const IconComponent = TYPE_ICON_MAP[artifact.type];
  const title = artifact.fileName || artifact.title;
  const subtitle = t(TYPE_LABEL_KEY[artifact.type]);
  const localPath = artifact.filePath?.trim() || '';
  const canOpenLocal = Boolean(localPath);

  return (
    <div className="theme-page-artifact-preview-card-button-1 flex max-w-sm w-full items-center gap-3 text-left">
      <Button
        type="button"
        variant="ghost"
        onClick={handleOpenPreview}
        className="flex min-w-0 flex-1 items-center justify-start gap-3 px-0 hover:bg-transparent"
      >
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
          <IconComponent className="h-5 w-5 text-primary" />
        </div>

        <div className="flex min-w-0 flex-1 flex-col items-start text-left">
          {canOpenLocal ? (
            // 文件名独立命中：阻止冒泡到整卡 toggle，只打开本地文件夹
            <span
              role="link"
              tabIndex={0}
              title={localPath}
              className="theme-surface-markdown-link inline-block max-w-full cursor-pointer truncate text-sm font-medium"
              onMouseDown={event => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onClick={handleOpenLocalFolder}
              onKeyDown={event => {
                if (event.key === 'Enter' || event.key === ' ') {
                  void handleOpenLocalFolder(event);
                }
              }}
            >
              {title}
            </span>
          ) : (
            <span className="truncate text-sm font-medium text-foreground">{title}</span>
          )}
          <span className="text-xs text-muted-foreground">{subtitle}</span>
        </div>

        <div className="flex shrink-0 items-center gap-1 text-sm font-medium text-primary">
          <ExternalLink className="h-4 w-4" />
          <span>{t('artifactOpen')}</span>
        </div>
      </Button>
    </div>
  );
};

export default ArtifactPreviewCard;
