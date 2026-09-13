/**
 * Temporal roles (§7.1): a role has `valid_from` / `valid_to` and is never overwritten. A
 * change of role closes the current row and adds a new one; the previous range survives.
 */
import { rolesCompatible } from './relations';

export interface RoleRow {
  id: string;
  role: string;
  validFrom: string;
  validTo: string | null;
}

export interface RolePlan {
  /** Rows to close (set `valid_to` to the day before the new role starts, never earlier than their start). */
  close: { id: string; validTo: string }[];
  /** A new row to add, or null when the role is already active. */
  add: { role: string; validFrom: string } | null;
}

const day = (iso: string) => iso.slice(0, 10);

function dayBefore(isoDay: string): string {
  const d = new Date(`${isoDay}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * What to do when evidence dated `at` says the entity holds `role`. Same active role: nothing.
 * A different active role that this one succeeds (partner → ex_partner) or contradicts within
 * the same family: close it as of the day before and add the new one. Unrelated roles
 * (friend + colleague) coexist.
 */
export function planRoleChange(existing: readonly RoleRow[], role: string, at: string): RolePlan {
  const from = day(at);
  const active = existing.filter((r) => r.validTo === null || r.validTo >= from);
  if (active.some((r) => r.role === role)) return { close: [], add: null };
  const close = active
    .filter((r) => r.role !== role && rolesCompatible(r.role, role))
    .map((r) => ({ id: r.id, validTo: maxDay(r.validFrom, dayBefore(from)) }));
  return { close, add: { role, validFrom: from } };
}

function maxDay(a: string, b: string): string {
  return a > b ? a : b;
}

/** The roles active on a given day, oldest first. */
export function activeRolesOn(existing: readonly RoleRow[], at: string): RoleRow[] {
  const d = day(at);
  return existing
    .filter((r) => r.validFrom <= d && (r.validTo === null || r.validTo >= d))
    .sort((a, b) => a.validFrom.localeCompare(b.validFrom));
}
