import { EditorView } from '@codemirror/view';

// ---------------------------------------------------------------------------
// CodeMirror theme extensions (module-level, stable references)
// ---------------------------------------------------------------------------

export const baseTheme = EditorView.theme({
  '&': {
    fontSize: 'var(--zy-component-text-sm)',
    fontFamily: 'var(--zy-style-font-mono)',
  },
  '.cm-gutters': { border: 'none', userSelect: 'none' },
  '.cm-lineNumbers .cm-gutterElement': {
    minWidth: '2.5em',
    padding: '0 8px 0 4px',
    fontSize: 'var(--zy-component-text-xs)',
    opacity: '0.5',
  },
  '.cm-content': { padding: '8px 0' },
  '.cm-line': { padding: '0 12px' },
  '.cm-cursor': { display: 'none !important' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { overflow: 'auto' },
  // Diff colors
  '.cm-deletedChunk': { backgroundColor: 'var(--zy-component-editor-deleted-chunk)' },
  '.cm-insertedChunk': { backgroundColor: 'var(--zy-component-editor-inserted-chunk)' },
  '.cm-changedText': { backgroundColor: 'var(--zy-component-editor-changed)' },
  // Custom search panel
  '.cm-search-custom': { display: 'flex', alignItems: 'center' },
  '.cm-search-input': { flex: '0 0 160px' },
  '.cm-search-count': { flex: '0 0 auto', minWidth: '36px', textAlign: 'center' },
  '.cm-search-nav-btn': {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
  },
  '.cm-search-sep': { margin: '0 2px', flex: '0 0 auto' },
  '.cm-search-opt': {
    display: 'inline-flex',
    alignItems: 'center',
    cursor: 'pointer',
    userSelect: 'none',
    whiteSpace: 'nowrap',
  },
  '.cm-search-opt input[type="checkbox"]': { margin: '0', cursor: 'pointer' },
  '.cm-search-close-btn': {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 'auto',
    cursor: 'pointer',
  },
  '.cm-searchMatch': {
    backgroundColor: 'var(--zy-component-editor-search)',
    borderRadius: '2px',
  },
  '.cm-searchMatch-selected': { backgroundColor: 'var(--zy-component-editor-search-selected)' },
  // Indentation markers
  '.cm-indent-markers': {
    '--indent-marker-bg-color': 'var(--zy-component-editor-indent-fallback)',
    '--indent-marker-active-bg-color': 'var(--zy-component-editor-indent-active-fallback)',
  },
});

export const darkThemeExt = EditorView.theme({
  '&': {
    backgroundColor: 'var(--zy-component-editor-background)',
    color: 'var(--zy-component-editor-foreground)',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--zy-component-editor-background)',
    color: 'var(--zy-component-editor-gutter)',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
    backgroundColor: 'var(--zy-component-editor-selection) !important',
  },
  '.cm-activeLine': { backgroundColor: 'var(--zy-component-editor-active-line)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--zy-component-editor-active-line)' },
  '.cm-deletedChunk .cm-line, .cm-changedChunk .cm-deletedLine': {
    backgroundColor: 'var(--zy-component-editor-deleted)',
  },
  '.cm-insertedChunk .cm-line, .cm-changedChunk .cm-insertedLine': {
    backgroundColor: 'var(--zy-component-editor-inserted)',
  },
  '.cm-indent-markers': {
    '--indent-marker-bg-color': 'var(--zy-component-editor-indent)',
    '--indent-marker-active-bg-color': 'var(--zy-component-editor-indent-active)',
  },
});

export const lightThemeExt = EditorView.theme({
  '&': {
    backgroundColor: 'var(--zy-component-editor-background)',
    color: 'var(--zy-component-editor-foreground)',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--zy-component-editor-background)',
    color: 'var(--zy-component-editor-gutter)',
  },
  '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
    backgroundColor: 'var(--zy-component-editor-selection) !important',
  },
  '.cm-activeLine': { backgroundColor: 'var(--zy-component-editor-active-line)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--zy-component-editor-active-line)' },
  '.cm-deletedChunk .cm-line, .cm-changedChunk .cm-deletedLine': {
    backgroundColor: 'var(--zy-component-editor-deleted)',
  },
  '.cm-insertedChunk .cm-line, .cm-changedChunk .cm-insertedLine': {
    backgroundColor: 'var(--zy-component-editor-inserted)',
  },
  '.cm-indent-markers': {
    '--indent-marker-bg-color': 'var(--zy-component-editor-indent)',
    '--indent-marker-active-bg-color': 'var(--zy-component-editor-indent-active)',
  },
});
