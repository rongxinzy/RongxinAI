import type { CSSProperties } from 'react';
export const prismTheme: Record<string, CSSProperties> = {
  'code[class*="language-"]': {
    background: 'var(--zy-syntax-prism-0-background)',
    color: 'var(--zy-syntax-prism-0-color)',
    fontFamily: 'var(--zy-syntax-prism-0-font-family)',
    direction: 'ltr',
    textAlign: 'left',
    whiteSpace: 'pre',
    wordSpacing: 'normal',
    wordBreak: 'normal',
    lineHeight: '1.5',
    MozTabSize: '2',
    OTabSize: '2',
    tabSize: '2',
    WebkitHyphens: 'none',
    MozHyphens: 'none',
    msHyphens: 'none',
    hyphens: 'none',
  },
  'pre[class*="language-"]': {
    background: 'var(--zy-syntax-prism-1-background)',
    color: 'var(--zy-syntax-prism-1-color)',
    fontFamily: 'var(--zy-syntax-prism-1-font-family)',
    direction: 'ltr',
    textAlign: 'left',
    whiteSpace: 'pre',
    wordSpacing: 'normal',
    wordBreak: 'normal',
    lineHeight: '1.5',
    MozTabSize: '2',
    OTabSize: '2',
    tabSize: '2',
    WebkitHyphens: 'none',
    MozHyphens: 'none',
    msHyphens: 'none',
    hyphens: 'none',
    padding: '1em',
    margin: '0.5em 0',
    overflow: 'auto',
    borderRadius: '0.3em',
  },
  'code[class*="language-"]::-moz-selection': {
    background: 'var(--zy-syntax-prism-2-background)',
    color: 'var(--zy-syntax-prism-2-color)',
  },
  'code[class*="language-"] *::-moz-selection': {
    background: 'var(--zy-syntax-prism-3-background)',
    color: 'var(--zy-syntax-prism-3-color)',
  },
  'pre[class*="language-"] *::-moz-selection': {
    background: 'var(--zy-syntax-prism-4-background)',
    color: 'var(--zy-syntax-prism-4-color)',
  },
  'code[class*="language-"]::selection': {
    background: 'var(--zy-syntax-prism-5-background)',
    color: 'var(--zy-syntax-prism-5-color)',
  },
  'code[class*="language-"] *::selection': {
    background: 'var(--zy-syntax-prism-6-background)',
    color: 'var(--zy-syntax-prism-6-color)',
  },
  'pre[class*="language-"] *::selection': {
    background: 'var(--zy-syntax-prism-7-background)',
    color: 'var(--zy-syntax-prism-7-color)',
  },
  ':not(pre) > code[class*="language-"]': {
    padding: '0.2em 0.3em',
    borderRadius: '0.3em',
    whiteSpace: 'normal',
  },
  comment: {
    color: 'var(--zy-syntax-prism-9-color)',
    fontStyle: 'italic',
  },
  prolog: {
    color: 'var(--zy-syntax-prism-10-color)',
  },
  cdata: {
    color: 'var(--zy-syntax-prism-11-color)',
  },
  doctype: {
    color: 'var(--zy-syntax-prism-12-color)',
  },
  punctuation: {
    color: 'var(--zy-syntax-prism-13-color)',
  },
  entity: {
    color: 'var(--zy-syntax-prism-14-color)',
    cursor: 'help',
  },
  'attr-name': {
    color: 'var(--zy-syntax-prism-15-color)',
  },
  'class-name': {
    color: 'var(--zy-syntax-prism-16-color)',
  },
  boolean: {
    color: 'var(--zy-syntax-prism-17-color)',
  },
  constant: {
    color: 'var(--zy-syntax-prism-18-color)',
  },
  number: {
    color: 'var(--zy-syntax-prism-19-color)',
  },
  atrule: {
    color: 'var(--zy-syntax-prism-20-color)',
  },
  keyword: {
    color: 'var(--zy-syntax-prism-21-color)',
  },
  property: {
    color: 'var(--zy-syntax-prism-22-color)',
  },
  tag: {
    color: 'var(--zy-syntax-prism-23-color)',
  },
  symbol: {
    color: 'var(--zy-syntax-prism-24-color)',
  },
  deleted: {
    color: 'var(--zy-syntax-prism-25-color)',
  },
  important: {
    color: 'var(--zy-syntax-prism-26-color)',
  },
  selector: {
    color: 'var(--zy-syntax-prism-27-color)',
  },
  string: {
    color: 'var(--zy-syntax-prism-28-color)',
  },
  char: {
    color: 'var(--zy-syntax-prism-29-color)',
  },
  builtin: {
    color: 'var(--zy-syntax-prism-30-color)',
  },
  inserted: {
    color: 'var(--zy-syntax-prism-31-color)',
  },
  regex: {
    color: 'var(--zy-syntax-prism-32-color)',
  },
  'attr-value': {
    color: 'var(--zy-syntax-prism-33-color)',
  },
  'attr-value > .token.punctuation': {
    color: 'var(--zy-syntax-prism-34-color)',
  },
  variable: {
    color: 'var(--zy-syntax-prism-35-color)',
  },
  operator: {
    color: 'var(--zy-syntax-prism-36-color)',
  },
  function: {
    color: 'var(--zy-syntax-prism-37-color)',
  },
  url: {
    color: 'var(--zy-syntax-prism-38-color)',
  },
  'attr-value > .token.punctuation.attr-equals': {
    color: 'var(--zy-syntax-prism-39-color)',
  },
  'special-attr > .token.attr-value > .token.value.css': {
    color: 'var(--zy-syntax-prism-40-color)',
  },
  '.language-css .token.selector': {
    color: 'var(--zy-syntax-prism-41-color)',
  },
  '.language-css .token.property': {
    color: 'var(--zy-syntax-prism-42-color)',
  },
  '.language-css .token.function': {
    color: 'var(--zy-syntax-prism-43-color)',
  },
  '.language-css .token.url > .token.function': {
    color: 'var(--zy-syntax-prism-44-color)',
  },
  '.language-css .token.url > .token.string.url': {
    color: 'var(--zy-syntax-prism-45-color)',
  },
  '.language-css .token.important': {
    color: 'var(--zy-syntax-prism-46-color)',
  },
  '.language-css .token.atrule .token.rule': {
    color: 'var(--zy-syntax-prism-47-color)',
  },
  '.language-javascript .token.operator': {
    color: 'var(--zy-syntax-prism-48-color)',
  },
  '.language-javascript .token.template-string > .token.interpolation > .token.interpolation-punctuation.punctuation':
    {
      color: 'var(--zy-syntax-prism-49-color)',
    },
  '.language-json .token.operator': {
    color: 'var(--zy-syntax-prism-50-color)',
  },
  '.language-json .token.null.keyword': {
    color: 'var(--zy-syntax-prism-51-color)',
  },
  '.language-markdown .token.url': {
    color: 'var(--zy-syntax-prism-52-color)',
  },
  '.language-markdown .token.url > .token.operator': {
    color: 'var(--zy-syntax-prism-53-color)',
  },
  '.language-markdown .token.url-reference.url > .token.string': {
    color: 'var(--zy-syntax-prism-54-color)',
  },
  '.language-markdown .token.url > .token.content': {
    color: 'var(--zy-syntax-prism-55-color)',
  },
  '.language-markdown .token.url > .token.url': {
    color: 'var(--zy-syntax-prism-56-color)',
  },
  '.language-markdown .token.url-reference.url': {
    color: 'var(--zy-syntax-prism-57-color)',
  },
  '.language-markdown .token.blockquote.punctuation': {
    color: 'var(--zy-syntax-prism-58-color)',
    fontStyle: 'italic',
  },
  '.language-markdown .token.hr.punctuation': {
    color: 'var(--zy-syntax-prism-59-color)',
    fontStyle: 'italic',
  },
  '.language-markdown .token.code-snippet': {
    color: 'var(--zy-syntax-prism-60-color)',
  },
  '.language-markdown .token.bold .token.content': {
    color: 'var(--zy-syntax-prism-61-color)',
  },
  '.language-markdown .token.italic .token.content': {
    color: 'var(--zy-syntax-prism-62-color)',
  },
  '.language-markdown .token.strike .token.content': {
    color: 'var(--zy-syntax-prism-63-color)',
  },
  '.language-markdown .token.strike .token.punctuation': {
    color: 'var(--zy-syntax-prism-64-color)',
  },
  '.language-markdown .token.list.punctuation': {
    color: 'var(--zy-syntax-prism-65-color)',
  },
  '.language-markdown .token.title.important > .token.punctuation': {
    color: 'var(--zy-syntax-prism-66-color)',
  },
  bold: {
    fontWeight: 'bold',
  },
  italic: {
    fontStyle: 'italic',
  },
  namespace: {
    opacity: '0.8',
  },
  'token.tab:not(:empty):before': {
    color: 'var(--zy-syntax-prism-70-color)',
  },
  'token.cr:before': {
    color: 'var(--zy-syntax-prism-71-color)',
  },
  'token.lf:before': {
    color: 'var(--zy-syntax-prism-72-color)',
  },
  'token.space:before': {
    color: 'var(--zy-syntax-prism-73-color)',
  },
  'div.code-toolbar > .toolbar.toolbar > .toolbar-item': {
    marginRight: '0.4em',
  },
  'div.code-toolbar > .toolbar.toolbar > .toolbar-item > button': {
    background: 'var(--zy-syntax-prism-75-background)',
    color: 'var(--zy-syntax-prism-75-color)',
    padding: '0.1em 0.4em',
    borderRadius: '0.3em',
  },
  'div.code-toolbar > .toolbar.toolbar > .toolbar-item > a': {
    background: 'var(--zy-syntax-prism-76-background)',
    color: 'var(--zy-syntax-prism-76-color)',
    padding: '0.1em 0.4em',
    borderRadius: '0.3em',
  },
  'div.code-toolbar > .toolbar.toolbar > .toolbar-item > span': {
    background: 'var(--zy-syntax-prism-77-background)',
    color: 'var(--zy-syntax-prism-77-color)',
    padding: '0.1em 0.4em',
    borderRadius: '0.3em',
  },
  'div.code-toolbar > .toolbar.toolbar > .toolbar-item > button:hover': {
    background: 'var(--zy-syntax-prism-78-background)',
    color: 'var(--zy-syntax-prism-78-color)',
  },
  'div.code-toolbar > .toolbar.toolbar > .toolbar-item > button:focus': {
    background: 'var(--zy-syntax-prism-79-background)',
    color: 'var(--zy-syntax-prism-79-color)',
  },
  'div.code-toolbar > .toolbar.toolbar > .toolbar-item > a:hover': {
    background: 'var(--zy-syntax-prism-80-background)',
    color: 'var(--zy-syntax-prism-80-color)',
  },
  'div.code-toolbar > .toolbar.toolbar > .toolbar-item > a:focus': {
    background: 'var(--zy-syntax-prism-81-background)',
    color: 'var(--zy-syntax-prism-81-color)',
  },
  'div.code-toolbar > .toolbar.toolbar > .toolbar-item > span:hover': {
    background: 'var(--zy-syntax-prism-82-background)',
    color: 'var(--zy-syntax-prism-82-color)',
  },
  'div.code-toolbar > .toolbar.toolbar > .toolbar-item > span:focus': {
    background: 'var(--zy-syntax-prism-83-background)',
    color: 'var(--zy-syntax-prism-83-color)',
  },
  '.line-highlight.line-highlight': {
    background: 'var(--zy-syntax-prism-84-background)',
  },
  '.line-highlight.line-highlight:before': {
    background: 'var(--zy-syntax-prism-85-background)',
    color: 'var(--zy-syntax-prism-85-color)',
    padding: '0.1em 0.6em',
    borderRadius: '0.3em',
    boxShadow: '0 2px 0 0 rgba(0, 0, 0, 0.2)',
  },
  '.line-highlight.line-highlight[data-end]:after': {
    background: 'var(--zy-syntax-prism-86-background)',
    color: 'var(--zy-syntax-prism-86-color)',
    padding: '0.1em 0.6em',
    borderRadius: '0.3em',
    boxShadow: '0 2px 0 0 rgba(0, 0, 0, 0.2)',
  },
  'pre[id].linkable-line-numbers.linkable-line-numbers span.line-numbers-rows > span:hover:before':
    {
      backgroundColor: 'var(--zy-syntax-prism-87-background-color)',
    },
  '.line-numbers.line-numbers .line-numbers-rows': {
    borderRightColor: 'hsla(230, 8%, 24%, 0.2)',
  },
  '.command-line .command-line-prompt': {
    borderRightColor: 'hsla(230, 8%, 24%, 0.2)',
  },
  '.line-numbers .line-numbers-rows > span:before': {
    color: 'var(--zy-syntax-prism-90-color)',
  },
  '.command-line .command-line-prompt > span:before': {
    color: 'var(--zy-syntax-prism-91-color)',
  },
  '.rainbow-braces .token.token.punctuation.brace-level-1': {
    color: 'var(--zy-syntax-prism-92-color)',
  },
  '.rainbow-braces .token.token.punctuation.brace-level-5': {
    color: 'var(--zy-syntax-prism-93-color)',
  },
  '.rainbow-braces .token.token.punctuation.brace-level-9': {
    color: 'var(--zy-syntax-prism-94-color)',
  },
  '.rainbow-braces .token.token.punctuation.brace-level-2': {
    color: 'var(--zy-syntax-prism-95-color)',
  },
  '.rainbow-braces .token.token.punctuation.brace-level-6': {
    color: 'var(--zy-syntax-prism-96-color)',
  },
  '.rainbow-braces .token.token.punctuation.brace-level-10': {
    color: 'var(--zy-syntax-prism-97-color)',
  },
  '.rainbow-braces .token.token.punctuation.brace-level-3': {
    color: 'var(--zy-syntax-prism-98-color)',
  },
  '.rainbow-braces .token.token.punctuation.brace-level-7': {
    color: 'var(--zy-syntax-prism-99-color)',
  },
  '.rainbow-braces .token.token.punctuation.brace-level-11': {
    color: 'var(--zy-syntax-prism-100-color)',
  },
  '.rainbow-braces .token.token.punctuation.brace-level-4': {
    color: 'var(--zy-syntax-prism-101-color)',
  },
  '.rainbow-braces .token.token.punctuation.brace-level-8': {
    color: 'var(--zy-syntax-prism-102-color)',
  },
  '.rainbow-braces .token.token.punctuation.brace-level-12': {
    color: 'var(--zy-syntax-prism-103-color)',
  },
  'pre.diff-highlight > code .token.token.deleted:not(.prefix)': {
    backgroundColor: 'var(--zy-syntax-prism-104-background-color)',
  },
  'pre > code.diff-highlight .token.token.deleted:not(.prefix)': {
    backgroundColor: 'var(--zy-syntax-prism-105-background-color)',
  },
  'pre.diff-highlight > code .token.token.deleted:not(.prefix)::-moz-selection': {
    backgroundColor: 'var(--zy-syntax-prism-106-background-color)',
  },
  'pre.diff-highlight > code .token.token.deleted:not(.prefix) *::-moz-selection': {
    backgroundColor: 'var(--zy-syntax-prism-107-background-color)',
  },
  'pre > code.diff-highlight .token.token.deleted:not(.prefix)::-moz-selection': {
    backgroundColor: 'var(--zy-syntax-prism-108-background-color)',
  },
  'pre > code.diff-highlight .token.token.deleted:not(.prefix) *::-moz-selection': {
    backgroundColor: 'var(--zy-syntax-prism-109-background-color)',
  },
  'pre.diff-highlight > code .token.token.deleted:not(.prefix)::selection': {
    backgroundColor: 'var(--zy-syntax-prism-110-background-color)',
  },
  'pre.diff-highlight > code .token.token.deleted:not(.prefix) *::selection': {
    backgroundColor: 'var(--zy-syntax-prism-111-background-color)',
  },
  'pre > code.diff-highlight .token.token.deleted:not(.prefix)::selection': {
    backgroundColor: 'var(--zy-syntax-prism-112-background-color)',
  },
  'pre > code.diff-highlight .token.token.deleted:not(.prefix) *::selection': {
    backgroundColor: 'var(--zy-syntax-prism-113-background-color)',
  },
  'pre.diff-highlight > code .token.token.inserted:not(.prefix)': {
    backgroundColor: 'var(--zy-syntax-prism-114-background-color)',
  },
  'pre > code.diff-highlight .token.token.inserted:not(.prefix)': {
    backgroundColor: 'var(--zy-syntax-prism-115-background-color)',
  },
  'pre.diff-highlight > code .token.token.inserted:not(.prefix)::-moz-selection': {
    backgroundColor: 'var(--zy-syntax-prism-116-background-color)',
  },
  'pre.diff-highlight > code .token.token.inserted:not(.prefix) *::-moz-selection': {
    backgroundColor: 'var(--zy-syntax-prism-117-background-color)',
  },
  'pre > code.diff-highlight .token.token.inserted:not(.prefix)::-moz-selection': {
    backgroundColor: 'var(--zy-syntax-prism-118-background-color)',
  },
  'pre > code.diff-highlight .token.token.inserted:not(.prefix) *::-moz-selection': {
    backgroundColor: 'var(--zy-syntax-prism-119-background-color)',
  },
  'pre.diff-highlight > code .token.token.inserted:not(.prefix)::selection': {
    backgroundColor: 'var(--zy-syntax-prism-120-background-color)',
  },
  'pre.diff-highlight > code .token.token.inserted:not(.prefix) *::selection': {
    backgroundColor: 'var(--zy-syntax-prism-121-background-color)',
  },
  'pre > code.diff-highlight .token.token.inserted:not(.prefix)::selection': {
    backgroundColor: 'var(--zy-syntax-prism-122-background-color)',
  },
  'pre > code.diff-highlight .token.token.inserted:not(.prefix) *::selection': {
    backgroundColor: 'var(--zy-syntax-prism-123-background-color)',
  },
  '.prism-previewer.prism-previewer:before': {
    borderColor: 'hsl(0, 0, 95%)',
  },
  '.prism-previewer-gradient.prism-previewer-gradient div': {
    borderColor: 'hsl(0, 0, 95%)',
    borderRadius: '0.3em',
  },
  '.prism-previewer-color.prism-previewer-color:before': {
    borderRadius: '0.3em',
  },
  '.prism-previewer-easing.prism-previewer-easing:before': {
    borderRadius: '0.3em',
  },
  '.prism-previewer.prism-previewer:after': {
    borderTopColor: 'hsl(0, 0, 95%)',
  },
  '.prism-previewer-flipped.prism-previewer-flipped.after': {
    borderBottomColor: 'hsl(0, 0, 95%)',
  },
  '.prism-previewer-angle.prism-previewer-angle:before': {
    background: 'var(--zy-syntax-prism-130-background)',
  },
  '.prism-previewer-time.prism-previewer-time:before': {
    background: 'var(--zy-syntax-prism-131-background)',
  },
  '.prism-previewer-easing.prism-previewer-easing': {
    background: 'var(--zy-syntax-prism-132-background)',
  },
  '.prism-previewer-angle.prism-previewer-angle circle': {
    stroke: 'hsl(230, 8%, 24%)',
    strokeOpacity: '1',
  },
  '.prism-previewer-time.prism-previewer-time circle': {
    stroke: 'hsl(230, 8%, 24%)',
    strokeOpacity: '1',
  },
  '.prism-previewer-easing.prism-previewer-easing circle': {
    stroke: 'hsl(230, 8%, 24%)',
    fill: 'transparent',
  },
  '.prism-previewer-easing.prism-previewer-easing path': {
    stroke: 'hsl(230, 8%, 24%)',
  },
  '.prism-previewer-easing.prism-previewer-easing line': {
    stroke: 'hsl(230, 8%, 24%)',
  },
};
