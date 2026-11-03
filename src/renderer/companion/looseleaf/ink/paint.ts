export type PaintKey =
  | 'ink'
  | 'ink-soft'
  | 'ink-you'
  | 'pencil'
  | 'pencil-mark'
  | 'red'
  | 'green'
  | 'marker'
  | 'hi'
  | 'focus'
  | 'paper'
  | 'paper-shade'
  | 'slip'
  | 'card'
  | 'graph'
  | 'kraft'
  | 'check'
  | 'photo'
  | 'desk'
  | 'desk-deep'
  | 'rule-blue'
  | 'rule-red'
  | 'pad'
  | 'pad-rule'
  | 'check-rule'
  | 'ink-muted'
  | 'pencil-text'
  | 'orange-text'
  | 'hi-deep'
  | 'tape'
  | 'tape-edge'
  | 'tomato'
  | 'tangerine'
  | 'lemon'
  | 'grass'
  | 'teal'
  | 'sky'
  | 'grape'
  | 'bubblegum'
  | 'sticky-yellow'
  | 'sticky-green'
  | 'sticky-orange'
  | 'sticky-pink'
  | 'sticky-blue'
  | 'current';

const PAINT_KEYS: readonly PaintKey[] = [
  'ink',
  'ink-soft',
  'ink-you',
  'pencil',
  'pencil-mark',
  'red',
  'green',
  'marker',
  'hi',
  'focus',
  'paper',
  'paper-shade',
  'slip',
  'card',
  'graph',
  'kraft',
  'check',
  'photo',
  'desk',
  'desk-deep',
  'rule-blue',
  'rule-red',
  'pad',
  'pad-rule',
  'check-rule',
  'ink-muted',
  'pencil-text',
  'orange-text',
  'hi-deep',
  'tape',
  'tape-edge',
  'tomato',
  'tangerine',
  'lemon',
  'grass',
  'teal',
  'sky',
  'grape',
  'bubblegum',
  'sticky-yellow',
  'sticky-green',
  'sticky-orange',
  'sticky-pink',
  'sticky-blue',
  'current',
];

const KNOWN = new Set<string>(PAINT_KEYS);

export const BLEND = 'normal';

export function paint(key: PaintKey): string {
  if (key === 'current') return 'currentColor';
  if (!KNOWN.has(key)) throw new Error(`ink: unknown paint key "${key}"`);
  const colors: Partial<Record<PaintKey, string>> = {
    ink: 'var(--foreground)',
    'ink-you': 'var(--primary)',
    pencil: 'var(--foreground)',
    'pencil-mark': 'var(--muted-foreground)',
    'paper-shade': 'var(--secondary)',
    paper: 'var(--popover)',
    slip: 'var(--popover)',
    hi: 'var(--secondary)',
    focus: 'var(--ring)',
  };
  return colors[key] ?? 'var(--foreground)';
}

export type Q = 10 | 20 | 100;

export function fmtUnits(k: number, q: Q): string {
  if (k === 0) return '0';
  const neg = k < 0;
  const a = neg ? -k : k;
  const whole = Math.floor(a / q);
  const frac = a - whole * q;
  let s = whole === 0 ? '' : String(whole);
  if (frac !== 0) {
    const digits = q === 10 ? 1 : 2;
    const f = String(frac * (10 ** digits / q))
      .padStart(digits, '0')
      .replace(/0+$/, '');
    s += '.' + f;
  }
  return neg ? '-' + s : s;
}

export function n(v: number, q: Q = 20): string {
  return Number.isFinite(v) ? fmtUnits(Math.round(v * q), q) : '0';
}

export function esc(s: string): string {
  return s.replace(/[&<>"']/g, c =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );
}
