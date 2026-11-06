import { Button } from '@shared/components/ui/button';
import { Input } from '@shared/components/ui/input';
import { cn } from '@shared/lib/utils';
import {
  Box,
  File,
  FileCode,
  FileQuestion,
  FileSpreadsheet,
  FileText,
  Globe,
  Image,
  Network,
  Palette,
} from 'lucide-react';
import React, { useMemo, useState } from 'react';

import { i18nService } from '@/services/i18n';
import type { Artifact, ArtifactType } from '@/types/artifact';
import { CoworkArtifactSource } from '../../../shared/cowork/artifacts';

const t = (key: string) => i18nService.t(key);

const TYPE_ICONS: Record<ArtifactType, React.ComponentType<{ className?: string }>> = {
  html: Globe,
  svg: Palette,
  image: Image,
  mermaid: Network,
  code: FileCode,
  markdown: FileText,
  text: File,
  document: FileSpreadsheet,
  model: Box,
  unsupported: FileQuestion,
};

const TYPE_ORDER: Record<ArtifactType, number> = {
  html: 0,
  svg: 1,
  image: 2,
  mermaid: 3,
  document: 4,
  model: 5,
  unsupported: 8,
  markdown: 5,
  text: 6,
  code: 7,
};

const TYPE_LABEL_KEYS: Record<ArtifactType, string> = {
  html: 'artifactTypeHtml',
  svg: 'artifactTypeSvg',
  image: 'artifactTypeImage',
  mermaid: 'artifactTypeMermaid',
  document: 'artifactTypeDocument',
  model: 'artifactTypeModel',
  unsupported: 'artifactTypeUnsupported',
  markdown: 'artifactTypeMarkdown',
  text: 'artifactTypeText',
  code: 'artifactCode',
};

function getShortPath(filePath: string): string {
  const parts = filePath.replace(/\\/g, '/').split('/');
  return parts.length > 2 ? `.../${parts.slice(-2).join('/')}` : parts.join('/');
}

interface FileDirectoryViewProps {
  artifacts: Artifact[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  compact?: boolean;
}

const FileDirectoryView: React.FC<FileDirectoryViewProps> = ({
  artifacts,
  selectedId,
  onSelect,
  compact,
}) => {
  const [search, setSearch] = useState('');

  const sortedAndFiltered = useMemo(() => {
    let items = artifacts;

    if (search.trim()) {
      const keyword = search.trim().toLowerCase();
      items = items.filter(a => {
        const name = (a.fileName || a.title || '').toLowerCase();
        return name.includes(keyword);
      });
    }

    return [...items].sort((a, b) => {
      const typeA = TYPE_ORDER[a.type] ?? 99;
      const typeB = TYPE_ORDER[b.type] ?? 99;
      if (typeA !== typeB) return typeA - typeB;
      const nameA = (a.fileName || a.title || '').toLowerCase();
      const nameB = (b.fileName || b.title || '').toLowerCase();
      return nameA.localeCompare(nameB);
    });
  }, [artifacts, search]);

  if (artifacts.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm p-4">
        {t('artifactEmptyFiles')}
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="px-3 py-2 shrink-0">
        <Input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder={t('artifactSearchPlaceholder')}
          className="theme-page-file-directory-view-input-1 w-full"
        />
      </div>
      <div className="flex-1 overflow-y-auto">
        {sortedAndFiltered.length === 0 ? (
          <div className="flex items-center justify-center text-muted-foreground text-xs p-4">
            {t('artifactEmptyFiles')}
          </div>
        ) : (
          sortedAndFiltered.map((artifact, idx) => {
            const showGroupHeader =
              !compact && (idx === 0 || artifact.type !== sortedAndFiltered[idx - 1].type);
            return (
              <React.Fragment key={artifact.id}>
                {showGroupHeader && (
                  <div className="px-3 pt-2 pb-1 text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    {t(TYPE_LABEL_KEYS[artifact.type] || 'artifactCode')}
                  </div>
                )}
                {(() => {
                  const IconComponent = TYPE_ICONS[artifact.type] || File;
                  return (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => onSelect(artifact.id)}
                      className={cn(
                        'theme-surface-file-row h-auto w-full justify-start gap-2 px-3 py-2 text-left font-normal',
                        artifact.id === selectedId
                          ? 'theme-surface-file-selected'
                          : 'theme-surface-file-idle',
                      )}
                    >
                      {!compact && (
                        <IconComponent
                          className="size-4 shrink-0 text-muted-foreground"
                          aria-hidden="true"
                        />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm">
                          {artifact.fileName || artifact.title}
                        </div>
                        {!compact && artifact.filePath && (
                          <div className="truncate text-xs text-muted-foreground">
                            {getShortPath(artifact.filePath)}
                          </div>
                        )}
                        {!compact &&
                          !artifact.filePath &&
                          artifact.source === CoworkArtifactSource.CodeBlock && (
                            <div className="text-xs text-muted-foreground">
                              {t('artifactResponseFragment')}
                            </div>
                          )}
                      </div>
                      {!compact && (
                        <span className="shrink-0 text-xs uppercase text-muted-foreground">
                          {artifact.type}
                        </span>
                      )}
                    </Button>
                  );
                })()}
              </React.Fragment>
            );
          })
        )}
      </div>
    </div>
  );
};

export default FileDirectoryView;
