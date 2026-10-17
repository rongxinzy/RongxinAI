import { LanguageSupport } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import React, { useEffect, useState } from 'react';

import { useCodeMirrorView } from './useCodeMirrorView';

// ---------------------------------------------------------------------------
// CodeMirrorEditor — thin wrapper that mounts the view into a DOM div
// ---------------------------------------------------------------------------

interface CodeMirrorEditorProps {
  doc: string;
  isDark: boolean;
  wrap: boolean;
  langSupport: LanguageSupport | null;
  onViewReady: (view: EditorView | null) => void;
  onSearchOpenChange: (open: boolean) => void;
}

export const CodeMirrorEditor: React.FC<CodeMirrorEditorProps> = ({
  doc,
  isDark,
  wrap,
  langSupport,
  onViewReady,
  onSearchOpenChange,
}) => {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);

  const view = useCodeMirrorView({
    container,
    doc,
    isDark,
    wrap,
    langSupport,
    onSearchOpenChange,
  });

  // Notify parent when view changes
  useEffect(() => {
    onViewReady(view);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  return <div ref={setContainer} />;
};
