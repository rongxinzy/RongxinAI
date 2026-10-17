import React from 'react';

import type { Artifact } from '@/types/artifact';

import { DocxSubRenderer } from './document/DocxSubRenderer';
import { FileInfoFallback } from './document/FileInfoFallback';
import { PdfSubRenderer } from './document/PdfSubRenderer';
import { PptxSubRenderer } from './document/PptxSubRenderer';
import { XlsxSubRenderer } from './document/XlsxSubRenderer';
import { getExtension, t } from './document/documentShared';

export { destroyPdfDocument } from './document/documentShared';

const MarkdownRenderer = React.lazy(() => import('./MarkdownRenderer'));
const DxfRenderer = React.lazy(() => import('./DxfRenderer'));

// --- Main Document Renderer ---

interface DocumentRendererProps {
  artifact: Artifact;
}

const DocumentRenderer: React.FC<DocumentRendererProps> = ({ artifact }) => {
  const ext = getExtension(artifact.fileName || artifact.filePath || '');
  const language = artifact.language?.toLowerCase();

  switch (ext) {
    case '.md':
    case '.markdown':
      return (
        <React.Suspense
          fallback={
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              {t('artifactDocumentLoading')}
            </div>
          }
        >
          <MarkdownRenderer artifact={artifact} />
        </React.Suspense>
      );
    case '.dxf':
      return (
        <React.Suspense
          fallback={
            <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
              {t('artifactDocumentLoading')}
            </div>
          }
        >
          <DxfRenderer artifact={artifact} />
        </React.Suspense>
      );
    case '.docm':
    case '.docx':
    case '.dotm':
    case '.dotx':
      return <DocxSubRenderer artifact={artifact} />;
    case '.xlsx':
    case '.xls':
    case '.xlsm':
    case '.xlam':
    case '.xlt':
    case '.xltm':
    case '.xltx':
    case '.csv':
    case '.tsv':
      return <XlsxSubRenderer artifact={artifact} />;
    case '.pdf':
      return <PdfSubRenderer artifact={artifact} />;
    case '.pptx':
    case '.pptm':
    case '.potm':
    case '.potx':
    case '.ppsm':
    case '.ppsx':
      return <PptxSubRenderer artifact={artifact} />;
    default:
      return language === 'csv' || language === 'tsv' ? (
        <XlsxSubRenderer artifact={artifact} />
      ) : (
        <FileInfoFallback artifact={artifact} />
      );
  }
};

export default DocumentRenderer;
