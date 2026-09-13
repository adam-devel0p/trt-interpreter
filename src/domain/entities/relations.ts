/**
 * Relational framing lexicon (§7.1 temporal relationships). A descriptor like "my girlfriend"
 * names a *role* (partner), not an identity; the role becomes an `entity_roles` row with a
 * date range and the descriptor an alias. Roles are stable machine keys; labels are separate.
 */
import type { EntityKind } from '../extraction/schema';

export interface RelationRole {
  role: string;
  label: string;
  kind: EntityKind;
  /** Normalised descriptors that name this role. */
  terms: readonly string[];
  /** A role this one commonly succeeds (partner → ex_partner); informs role_consistency. */
  succeeds?: string;
}

export const RELATION_ROLES: readonly RelationRole[] = [
  {
    role: 'partner',
    label: 'Partner',
    kind: 'person',
    terms: [
      'girlfriend',
      'boyfriend',
      'partner',
      'wife',
      'husband',
      'spouse',
      'fiance',
      'fiancee',
      'fiancé',
      'fiancée',
      'other half',
    ],
  },
  {
    role: 'ex_partner',
    label: 'Ex-partner',
    kind: 'person',
    terms: [
      'ex',
      'ex girlfriend',
      'ex-girlfriend',
      'ex boyfriend',
      'ex-boyfriend',
      'ex partner',
      'ex-partner',
      'ex wife',
      'ex-wife',
      'ex husband',
      'ex-husband',
    ],
    succeeds: 'partner',
  },
  {
    role: 'friend',
    label: 'Friend',
    kind: 'person',
    terms: ['friend', 'best friend', 'mate', 'old friend', 'close friend'],
  },
  {
    role: 'colleague',
    label: 'Colleague',
    kind: 'person',
    terms: ['colleague', 'coworker', 'co-worker', 'teammate', 'workmate'],
  },
  {
    role: 'manager',
    label: 'Manager',
    kind: 'person',
    terms: ['boss', 'manager', 'line manager', 'supervisor', 'director'],
  },
  {
    role: 'employer',
    label: 'Employer',
    kind: 'organization',
    terms: [
      'employer',
      'company',
      'firm',
      'agency',
      'the agency',
      'the company',
      'work',
      'the office',
      'studio',
    ],
  },
  {
    role: 'former_employer',
    label: 'Former employer',
    kind: 'organization',
    terms: ['old company', 'old agency', 'former employer', 'previous company', 'old job'],
    succeeds: 'employer',
  },
  {
    role: 'parent',
    label: 'Parent',
    kind: 'person',
    terms: ['mum', 'mom', 'mother', 'dad', 'father', 'parent', 'parents'],
  },
  {
    role: 'sibling',
    label: 'Sibling',
    kind: 'person',
    terms: ['brother', 'sister', 'sibling', 'bro', 'sis'],
  },
  {
    role: 'child',
    label: 'Child',
    kind: 'person',
    terms: ['son', 'daughter', 'kid', 'child', 'kids', 'children'],
  },
  {
    role: 'relative',
    label: 'Relative',
    kind: 'person',
    terms: [
      'aunt',
      'uncle',
      'cousin',
      'grandmother',
      'grandfather',
      'gran',
      'grandma',
      'grandad',
      'nan',
      'in-laws',
      'mother in law',
      'father in law',
    ],
  },
  {
    role: 'flatmate',
    label: 'Flatmate',
    kind: 'person',
    terms: ['flatmate', 'roommate', 'housemate'],
  },
  {
    role: 'therapist',
    label: 'Therapist',
    kind: 'person',
    terms: ['therapist', 'counsellor', 'counselor', 'doctor', 'gp'],
  },
  {
    role: 'landlord',
    label: 'Landlord',
    kind: 'person',
    terms: ['landlord', 'landlady', 'letting agent'],
  },
  {
    role: 'client',
    label: 'Client',
    kind: 'organization',
    terms: ['client', 'the client', 'customer'],
  },
  {
    role: 'home',
    label: 'Home',
    kind: 'place',
    terms: ['home', 'the flat', 'the house', 'my flat', 'my house', 'the apartment'],
  },
];

const byTerm = new Map<string, RelationRole>();
for (const r of RELATION_ROLES) for (const t of r.terms) byTerm.set(t, r);

/** The role a normalised descriptor names ("girlfriend" → partner), or null for a name/other. */
export function roleForDescriptor(normalized: string): RelationRole | null {
  return byTerm.get(normalized) ?? null;
}

/** The role a free-text relation from the extractor names ("partner", "my boss", "Employer"). */
export function roleForRelation(relation: string | null | undefined): RelationRole | null {
  if (!relation) return null;
  const n = relation
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]+/gu, ' ')
    .replace(/^(my|our|the|his|her|their)\s+/, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!n) return null;
  return (
    RELATION_ROLES.find((r) => r.role === n || r.role.replace('_', ' ') === n) ??
    byTerm.get(n) ??
    null
  );
}

export function isDescriptor(normalized: string): boolean {
  return byTerm.has(normalized);
}

export function roleLabel(role: string): string {
  return RELATION_ROLES.find((r) => r.role === role)?.label ?? role.replace(/_/g, ' ');
}

/** Two roles are compatible when equal, or when one is the successor of the other. */
export function rolesCompatible(a: string, b: string): boolean {
  if (a === b) return true;
  const ra = RELATION_ROLES.find((r) => r.role === a);
  const rb = RELATION_ROLES.find((r) => r.role === b);
  return ra?.succeeds === b || rb?.succeeds === a;
}

/**
 * Role families. People hold several roles at once (a colleague can be a friend), so roles
 * from different families never conflict. Within `kin` different roles exclude each other, and
 * `romance` excludes `kin`. Everything else is merely new information.
 */
const FAMILY: Record<string, string> = {
  partner: 'romance',
  ex_partner: 'romance',
  parent: 'kin',
  sibling: 'kin',
  child: 'kin',
  relative: 'kin',
};

export function rolesExclusive(a: string, b: string): boolean {
  if (a === b) return false;
  const fa = FAMILY[a];
  const fb = FAMILY[b];
  if (!fa || !fb) return false;
  if (fa === 'kin' && fb === 'kin') return true;
  return fa !== fb;
}
