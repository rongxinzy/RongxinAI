import { defaultKeymap, historyKeymap } from '@codemirror/commands';
import {
  bracketMatching,
  foldGutter,
  foldKeymap,
  LanguageSupport,
  syntaxHighlighting,
} from '@codemirror/language';
import {
  highlightSelectionMatches,
  search,
  searchKeymap,
  searchPanelOpen,
} from '@codemirror/search';
import { Compartment, EditorState, Extension } from '@codemirror/state';
import {
  crosshairCursor,
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  rectangularSelection,
} from '@codemirror/view';
import { indentationMarkers } from '@replit/codemirror-indentation-markers';
import { useEffect, useRef, useState } from 'react';

import { editorHighlightStyle } from '../../theme/syntax/codemirror';
import { baseTheme, darkThemeExt, lightThemeExt } from './editorTheme';
import { buildSearchPanel } from './searchPanel';

// ---------------------------------------------------------------------------
// useCodeMirrorView — creates and manages a raw EditorView with Compartments
// so dynamic props (theme, wrap, language) can be reconfigured without
// destroying the search panel state.
// ---------------------------------------------------------------------------

interface UseCodeMirrorViewOptions {
  container: HTMLDivElement | null;
  doc: string;
  isDark: boolean;
  wrap: boolean;
  langSupport: LanguageSupport | null;
  onSearchOpenChange: (open: boolean) => void;
}

export function useCodeMirrorView({
  container,
  doc,
  isDark,
  wrap,
  langSupport,
  onSearchOpenChange,
}: UseCodeMirrorViewOptions): EditorView | null {
  const viewRef = useRef<EditorView | null>(null);

  // Stable compartments (created once per CodeBlock instance)
  const themeCompartment = useRef(new Compartment());
  const wrapCompartment = useRef(new Compartment());
  const langCompartment = useRef(new Compartment());

  // Keep a ref to the callback so the updateListener doesn't go stale
  const onSearchOpenChangeRef = useRef(onSearchOpenChange);
  onSearchOpenChangeRef.current = onSearchOpenChange;

  // Expose the current view via a ref for imperative access
  const [, forceUpdate] = useState(0);

  // Create the view once when the container is mounted
  useEffect(() => {
    if (!container) return;

    const initialTheme = isDark ? darkThemeExt : lightThemeExt;
    const initialWrap = wrap ? EditorView.lineWrapping : [];
    const initialLang: Extension = langSupport ?? [];

    const state = EditorState.create({
      doc,
      extensions: [
        // ── Static extensions (never reconfigured) ──────────────────────
        baseTheme,
        EditorView.editable.of(false),
        EditorState.readOnly.of(true),

        // Line numbers + fold gutter
        lineNumbers(),
        foldGutter(),

        // Bracket matching, selection highlight
        bracketMatching(),
        highlightSelectionMatches(),
        drawSelection(),

        // Active line highlight
        highlightActiveLine(),
        highlightActiveLineGutter(),

        // Multi-selection
        rectangularSelection(),
        crosshairCursor(),

        // Indentation guides
        indentationMarkers(),

        // Syntax highlighting
        syntaxHighlighting(editorHighlightStyle),

        // Search — custom panel with match counter
        search({ createPanel: buildSearchPanel }),

        // Keymaps
        keymap.of([...defaultKeymap, ...historyKeymap, ...foldKeymap, ...searchKeymap]),

        // Listener to sync searchOpen React state with editor panel state
        EditorView.updateListener.of(update => {
          if (update.transactions.length > 0) {
            onSearchOpenChangeRef.current(searchPanelOpen(update.state));
          }
        }),

        // ── Dynamic compartments (reconfigured on prop changes) ─────────
        themeCompartment.current.of(initialTheme),
        wrapCompartment.current.of(initialWrap),
        langCompartment.current.of(initialLang),
      ],
    });

    const view = new EditorView({ state, parent: container });
    viewRef.current = view;
    forceUpdate(n => n + 1); // tell consumers the view is ready

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [container]); // only re-create when the DOM container changes

  // Reconfigure theme compartment when isDark changes
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: themeCompartment.current.reconfigure(isDark ? darkThemeExt : lightThemeExt),
    });
  }, [isDark]);

  // Reconfigure wrap compartment when wrap changes
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: wrapCompartment.current.reconfigure(wrap ? EditorView.lineWrapping : []),
    });
  }, [wrap]);

  // Reconfigure language compartment when langSupport changes
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: langCompartment.current.reconfigure(langSupport ?? []),
    });
  }, [langSupport]);

  // Update document content if it changes (shouldn't happen for read-only
  // chat messages, but guard anyway)
  const prevDocRef = useRef(doc);
  useEffect(() => {
    const view = viewRef.current;
    if (!view || doc === prevDocRef.current) return;
    prevDocRef.current = doc;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: doc },
    });
  }, [doc]);

  return viewRef.current;
}
