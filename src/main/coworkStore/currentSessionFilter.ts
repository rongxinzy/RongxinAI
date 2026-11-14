import { CoworkSessionSource } from '../../shared/cowork/constants';

/** Retired session rows stay on disk and are outside every current session read. */
export function currentSessionFilter(
  sources?: readonly CoworkSessionSource[],
  column: 'source' | 's.source' = 'source',
): { sql: string; params: CoworkSessionSource[] } {
  const current = Object.values(CoworkSessionSource);
  const selected = [...new Set(sources?.length ? sources : current)].filter(source =>
    current.includes(source),
  );
  return {
    sql: selected.length ? `${column} IN (${selected.map(() => '?').join(', ')})` : '0',
    params: selected,
  };
}
