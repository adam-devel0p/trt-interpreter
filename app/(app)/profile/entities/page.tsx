import Link from 'next/link';
import { getSessionClient, requireUser } from '@/auth/session';
import { listEntities } from '@/db/queries/memory';
import { roleLabel } from '@/domain/entities/relations';
import type { EntityKind } from '@/domain/extraction/schema';
import { EmptyState } from '@/ui/components/empty-state';
import { LocalTime } from '@/ui/components/local-time';
import { PageHeader } from '@/ui/components/page-header';

export const metadata = { title: 'People & places' };
export const dynamic = 'force-dynamic';

const KIND_ORDER: EntityKind[] = ['person', 'organization', 'place', 'project', 'object', 'other'];
const KIND_TITLE: Record<EntityKind, string> = {
  person: 'People',
  organization: 'Organisations',
  place: 'Places',
  project: 'Projects',
  object: 'Things',
  other: 'Other',
};

/**
 * The entities the journal has grown (§7.1): who and what keeps coming up, with how they
 * were named, their current role and how many readings mention them. Everything here was
 * inferred unless marked as confirmed by you; each entry opens a page to correct it.
 */
export default async function EntitiesPage() {
  await requireUser();
  const client = await getSessionClient();
  const entities = await listEntities(client);
  const groups = KIND_ORDER.map((k) => ({
    kind: k,
    items: entities.filter((e) => e.kind === k),
  })).filter((g) => g.items.length > 0);

  return (
    <>
      <PageHeader
        eyebrow="Profile"
        title="People & places"
        description="Who and what your readings keep mentioning. Suggested unless you have confirmed it; open any entry to correct, merge or split."
      />
      {groups.length === 0 ? (
        <EmptyState
          title="No one yet."
          description="As you write readings, the people, places and organisations you mention will collect here — matched by the names you use, never by guesswork about who you mean."
          action={
            <Link href="/journal" className="text-sm text-accent underline underline-offset-4">
              Open the journal
            </Link>
          }
        />
      ) : null}
      {groups.map((g) => (
        <section key={g.kind} aria-labelledby={`kind-${g.kind}`} className="mb-8">
          <h2 id={`kind-${g.kind}`} className="mb-2 font-serif text-xl">
            {KIND_TITLE[g.kind]}
          </h2>
          <ul className="divide-y divide-hairline rounded-card bg-surface hairline">
            {g.items.map((e) => (
              <li key={e.id}>
                <Link
                  href={`/profile/entities/${e.id}`}
                  className="flex min-h-14 items-center gap-3 px-4 py-3 hover:bg-surface-2"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-baseline gap-x-2">
                      <span className="font-medium">{e.canonical_label}</span>
                      <span className="text-xs text-fg-muted">
                        {e.user_confirmed ? 'confirmed by you' : 'suggested'}
                      </span>
                    </span>
                    <span className="block text-xs text-fg-muted">
                      {e.roles.length ? `${e.roles.map((r) => roleLabel(r)).join(', ')} · ` : ''}
                      {e.alias_count} {e.alias_count === 1 ? 'name' : 'names'} · in{' '}
                      {e.reading_count} {e.reading_count === 1 ? 'reading' : 'readings'} · first{' '}
                      <LocalTime iso={e.first_seen_at} dateOnly /> · last{' '}
                      <LocalTime iso={e.last_seen_at} dateOnly />
                    </span>
                  </span>
                  <span aria-hidden="true" className="text-fg-muted">
                    ›
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}
