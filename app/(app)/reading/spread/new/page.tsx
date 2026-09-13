import { getSessionClient, requireUser } from '@/auth/session';
import { listCustomSpreads } from '@/db/queries/spreads';
import { PageHeader } from '@/ui/components/page-header';
import { SpreadBuilder } from './spread-builder';

export const metadata = { title: 'Custom spread' };
export const dynamic = 'force-dynamic';

/** Custom spreads (FR-05): name the positions; the layout arranges itself. */
export default async function NewSpreadPage() {
  await requireUser();
  const mine = await listCustomSpreads(await getSessionClient());
  return (
    <>
      <PageHeader
        title="Custom spread"
        description="Name each position and, if you like, what it asks. The layout arranges itself."
      />
      <SpreadBuilder
        existing={mine.map((s) => ({ id: s.id, name: s.name, card_count: s.card_count }))}
      />
    </>
  );
}
