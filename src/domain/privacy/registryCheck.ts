import { coveredTables, REFERENCE_TABLES } from './deletionRegistry';

/**
 * Structural check over a Drizzle schema module. Kept dependency-free: it only reads the
 * `Symbol(drizzle:Name)` and column keys that pgTable objects expose, so domain/ still imports
 * nothing from db/ (the schema is passed in by the caller).
 */
export function userOwnedTablesMissingFromRegistry(schema: Record<string, unknown>): string[] {
  const covered = coveredTables();
  const missing: string[] = [];
  for (const value of Object.values(schema)) {
    const table = readTable(value);
    if (!table) continue;
    if (REFERENCE_TABLES.includes(table.name)) continue;
    if (table.columns.has('user_id') && !covered.has(table.name)) missing.push(table.name);
  }
  return missing.sort();
}

function readTable(value: unknown): { name: string; columns: Set<string> } | null {
  if (typeof value !== 'object' || value === null) return null;
  const sym = Object.getOwnPropertySymbols(value).find((s) => s.description === 'drizzle:Name');
  if (!sym) return null;
  const name = (value as Record<symbol, unknown>)[sym];
  if (typeof name !== 'string') return null;
  const colsSym = Object.getOwnPropertySymbols(value).find(
    (s) => s.description === 'drizzle:Columns',
  );
  const cols = colsSym ? (value as Record<symbol, unknown>)[colsSym] : undefined;
  const columns = new Set<string>();
  if (typeof cols === 'object' && cols !== null) {
    for (const c of Object.values(cols as Record<string, { name?: string }>)) {
      if (c && typeof c.name === 'string') columns.add(c.name);
    }
  }
  return { name, columns };
}
