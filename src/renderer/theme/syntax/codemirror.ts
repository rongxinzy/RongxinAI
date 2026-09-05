import { defaultHighlightStyle, HighlightStyle } from '@codemirror/language';
const colors: Record<string, string> = {
  '#404740': 'var(--zy-syntax-codemirror-0)',
  '#708': 'var(--zy-syntax-codemirror-6)',
  '#219': 'var(--zy-syntax-codemirror-7)',
  '#164': 'var(--zy-syntax-codemirror-8)',
  '#a11': 'var(--zy-syntax-codemirror-9)',
  '#e40': 'var(--zy-syntax-codemirror-10)',
  '#00f': 'var(--zy-syntax-codemirror-11)',
  '#30a': 'var(--zy-syntax-codemirror-12)',
  '#085': 'var(--zy-syntax-codemirror-13)',
  '#167': 'var(--zy-syntax-codemirror-14)',
  '#256': 'var(--zy-syntax-codemirror-15)',
  '#00c': 'var(--zy-syntax-codemirror-16)',
  '#940': 'var(--zy-syntax-codemirror-17)',
  '#f00': 'var(--zy-syntax-codemirror-18)',
};
export const editorHighlightStyle = HighlightStyle.define(
  defaultHighlightStyle.specs.map(spec => ({
    ...spec,
    ...(spec.color ? { color: colors[spec.color] } : {}),
  })),
);
