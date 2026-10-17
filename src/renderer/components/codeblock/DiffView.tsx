import { LanguageSupport } from '@codemirror/language';
import { unifiedMergeView } from '@codemirror/merge';
import { Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import CodeMirror from '@uiw/react-codemirror';
import React, { useMemo } from 'react';

import { baseTheme, darkThemeExt, lightThemeExt } from './editorTheme';

// ---------------------------------------------------------------------------
// Unified diff view component
// ---------------------------------------------------------------------------

interface DiffViewProps {
  original: string;
  modified: string;
  langSupport: LanguageSupport | null;
  isDark: boolean;
  wrap: boolean;
}

export const DiffView: React.FC<DiffViewProps> = ({
  original,
  modified,
  langSupport,
  isDark,
  wrap,
}) => {
  const extensions = useMemo(() => {
    const exts: Extension[] = [
      baseTheme,
      isDark ? darkThemeExt : lightThemeExt,
      EditorView.editable.of(false),
      unifiedMergeView({
        original,
        highlightChanges: true,
        gutter: true,
        mergeControls: false,
        syntaxHighlightDeletions: true,
        allowInlineDiffs: true,
      }),
    ];
    if (wrap) exts.push(EditorView.lineWrapping);
    if (langSupport) exts.push(langSupport);
    return exts;
  }, [original, isDark, wrap, langSupport]);

  return (
    <CodeMirror
      value={modified}
      extensions={extensions}
      editable={false}
      readOnly={true}
      basicSetup={{
        lineNumbers: true,
        foldGutter: false,
        highlightActiveLine: false,
        highlightActiveLineGutter: false,
        indentOnInput: false,
        bracketMatching: false,
        closeBrackets: false,
        autocompletion: false,
        rectangularSelection: false,
        crosshairCursor: false,
        dropCursor: false,
        allowMultipleSelections: false,
        searchKeymap: false,
        highlightSelectionMatches: false,
      }}
      theme="none"
    />
  );
};
