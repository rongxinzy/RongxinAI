import { MAX_CONTEXT_TOKENS } from '../../../../shared/magpie/contexts';

/**
 * Provider context windows are token counts. The app parses the shorthand
 * itself (binary units: 1k = 1024, 1m = 1048576) so what the field shows after
 * parsing is exactly what is sent to the gateway; upstream's CLI uses decimal
 * units, so an integer is always safe to paste there.
 */

export type ParsedContext = { ok: true; value?: number } | { ok: false };

export function parseContextTokens(input: string): ParsedContext {
  const trimmed = input.trim().replaceAll('_', '');
  if (!trimmed) return { ok: true, value: undefined };
  const match = /^(\d+(?:\.\d+)?)\s*([km])?$/i.exec(trimmed);
  if (!match) return { ok: false };
  const amount = Number(match[1]);
  const unit = match[2]?.toLowerCase();
  const multiplier = unit === 'k' ? 1024 : unit === 'm' ? 1024 * 1024 : 1;
  const value = Math.round(amount * multiplier);
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_CONTEXT_TOKENS) {
    return { ok: false };
  }
  return { ok: true, value };
}

/** Plain integer, so `64k` never reads back as an ambiguous `64k`. */
export function formatContextTokens(value: number | undefined): string {
  return value === undefined ? '' : String(value);
}
