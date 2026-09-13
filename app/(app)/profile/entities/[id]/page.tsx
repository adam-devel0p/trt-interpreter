import Link from 'next/link';
import { notFound } from 'next/navigation';
import { z } from 'zod';
import { getSessionClient, requireUser } from '@/auth/session';
import { getEntity, listEntities, roleOptions } from '@/db/queries/memory';
import { roleLabel } from '@/domain/entities/relations';
import { LocalTime } from '@/ui/components/local-time';
import { PageHeader } from '@/ui/components/page-header';
import {
  AliasesControl,
  MergeControl,
  MergeUndoNotice,
  NotesControl,
  RemoveControl,
  RenameControl,
  RolesControl,
  SplitControl,
} from './controls';

export const dynamic = 'force-dynamic';

/**
 * One entity (§7.1, FR-27): the names it goes by, its roles over time, every mention with a
 * link to the reading it came from, and the corrections — rename, alias, role, merge, split,
 * remove. Every inferred value says so and shows why.
 */
export default async function EntityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  await requireUser();
  const client = await getSessionClient();
  const entity = await getEntity(client, id);
  if (!entity) notFound();
  if (entity.status === 'merged' && entity.merged_into_id) {
    const into = await getEntity(client, entity.merged_into_id);
    return (
      <>
        <PageHeader eyebrow="People & places" title={entity.canonical_label} />
        <p className="text-sm text-fg-muted">
          Merged into{' '}
          <Link
            href={`/profile/entities/${entity.merged_into_id}`}
            className="text-accent underline underline-offset-4"
          >
            {into?.canonical_label ?? 'another entry'}
          </Link>
          . Undo from that page.
        </p>
      </>
    );
  }
  const others = (await listEntities(client)).filter((e) => e.id !== entity.id);
  const active = entity.roles.filter((r) => r.valid_to === null);

  return (
    <>
      <PageHeader
        eyebrow="People & places"
        title={entity.canonical_label}
        description={`${kindWord(entity.kind)} · ${entity.user_confirmed ? 'confirmed by you' : 'suggested from your readings'}`}
        action={
          <Link
            href="/profile/entities"
            className="text-sm text-accent underline underline-offset-4"
          >
            All
          </Link>
        }
      />
      <p className="-mt-3 mb-5 text-sm text-fg-muted">
        First <LocalTime iso={entity.first_seen_at} dateOnly /> · last{' '}
        <LocalTime iso={entity.last_seen_at} dateOnly />
        {active.length ? ` · ${active.map((r) => roleLabel(r.role)).join(', ')}` : ''}
      </p>

      <MergeUndoNotice entityId={entity.id} merges={entity.merges} />

      <section aria-labelledby="name-h" className="mb-8">
        <h2 id="name-h" className="mb-2 font-serif text-xl">
          Name
        </h2>
        <RenameControl
          entityId={entity.id}
          label={entity.canonical_label}
          confirmed={entity.user_confirmed}
        />
        <NotesControl entityId={entity.id} notes={entity.notes} />
      </section>

      <section aria-labelledby="aliases-h" className="mb-8">
        <h2 id="aliases-h" className="mb-1 font-serif text-xl">
          Also called
        </h2>
        <p className="mb-2 text-sm text-fg-muted">
          The names and phrases your readings use. Names are not identity — you can add or remove
          any.
        </p>
        <AliasesControl entityId={entity.id} aliases={entity.aliases} />
      </section>

      <section aria-labelledby="roles-h" className="mb-8">
        <h2 id="roles-h" className="mb-1 font-serif text-xl">
          Roles over time
        </h2>
        <p className="mb-2 text-sm text-fg-muted">
          A role has a start and, when it changes, an end. Earlier roles are kept, never
          overwritten.
        </p>
        <RolesControl entityId={entity.id} roles={entity.roles} options={roleOptions()} />
      </section>

      <section aria-labelledby="mentions-h" className="mb-8">
        <h2 id="mentions-h" className="mb-1 font-serif text-xl">
          Mentions
        </h2>
        <p className="mb-2 text-sm text-fg-muted">
          Every reading this entry was found in, with how it was named there and why it was matched.
        </p>
        {entity.mentions.length === 0 ? (
          <p className="text-sm text-fg-muted">No mentions yet.</p>
        ) : (
          <ul className="divide-y divide-hairline rounded-card bg-surface hairline">
            {entity.mentions.map((m) => (
              <li key={m.id} className="px-4 py-3 text-sm">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium">“{m.mention_text}”</span>
                  <span className="text-xs text-fg-muted">
                    {m.resolution === 'user'
                      ? 'linked by you'
                      : m.resolution === 'tentative'
                        ? 'possibly'
                        : m.resolution === 'rejected'
                          ? 'dismissed'
                          : 'suggested'}
                  </span>
                </div>
                {m.reading ? (
                  <Link
                    href={`/reading/${m.reading.id}`}
                    className="text-accent underline underline-offset-4"
                  >
                    <LocalTime iso={m.reading.occurred_at} dateOnly /> ·{' '}
                    {m.reading.is_open_reflection
                      ? 'Open reflection'
                      : (m.reading.question ?? 'Reading')}
                  </Link>
                ) : (
                  <span className="text-fg-muted">A reading that is no longer here.</span>
                )}
                {m.reasons.length ? (
                  <details className="mt-1 text-xs text-fg-muted">
                    <summary className="cursor-pointer">Why this was matched</summary>
                    <ul className="mt-1 list-disc pl-4">
                      {m.reasons.map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="fix-h" className="mb-8">
        <h2 id="fix-h" className="mb-1 font-serif text-xl">
          Merge, split or remove
        </h2>
        <p className="mb-3 text-sm text-fg-muted">
          Two entries for one person? Merge them — every name, mention and role moves, and it can be
          undone. One entry for two people? Split off the mentions that belong to someone else.
        </p>
        <div className="flex flex-col gap-3">
          <MergeControl entityId={entity.id} label={entity.canonical_label} others={others} />
          <SplitControl entityId={entity.id} kind={entity.kind} mentions={entity.mentions} />
          <RemoveControl
            entityId={entity.id}
            label={entity.canonical_label}
            mentionCount={entity.mentions.length}
          />
        </div>
      </section>
    </>
  );
}

function kindWord(kind: string): string {
  return (
    {
      person: 'Person',
      organization: 'Organisation',
      place: 'Place',
      project: 'Project',
      object: 'Thing',
      other: 'Other',
    }[kind] ?? kind
  );
}

export async function generateMetadata() {
  return { title: 'Entity' };
}
