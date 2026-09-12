import Link from 'next/link';
import { redirect } from 'next/navigation';
import { signOutAction } from '@/auth/actions';
import { getSessionClient, requireUser } from '@/auth/session';
import { listDecks } from '@/db/queries/decks';
import { getProfile, hasAiConsent } from '@/db/queries/profile';
import { Button } from '@/ui/components/button';
import { PageHeader } from '@/ui/components/page-header';
import { SettingsRow, SettingsSection } from '@/ui/components/settings';
import { ConsentToggle, DeckSelect, DepthSelect, ReversalsToggle } from './controls';

export const metadata = { title: 'Profile' };
export const dynamic = 'force-dynamic';

/**
 * Profile (§5): account, privacy, deck preferences, reminders, subscription, export/delete.
 * Real controls where the feature exists; labeled placeholders that name their phase where
 * it does not. Export and delete are visible now so ownership is never in doubt (§4.6).
 */
export default async function ProfilePage() {
  const user = await requireUser();
  const client = await getSessionClient();
  const [profile, decks] = await Promise.all([getProfile(client, user.id), listDecks(client)]);
  if (!profile) redirect('/sign-in');
  const consented = hasAiConsent(profile);
  const defaultDeck = decks.find((d) => d.id === profile.default_deck_id) ?? decks[0];
  const noReversalDecks = decks.filter((d) => !d.supports_reversals).map((d) => d.name);

  return (
    <>
      <PageHeader title="Profile" />

      <SettingsSection title="Account">
        <SettingsRow label="Email" description={user.email ?? 'Signed in'} />
        <SettingsRow
          label="Sign out"
          control={
            <form action={signOutAction}>
              <Button type="submit" variant="secondary" size="sm">
                Sign out
              </Button>
            </form>
          }
        />
      </SettingsSection>

      <SettingsSection
        title="Deck preferences"
        description="Rider–Waite–Smith and Thoth are both first-class. You can still pick either deck for any reading."
      >
        <SettingsRow
          label="Default deck"
          labelId="deck-label"
          description={
            defaultDeck
              ? `${defaultDeck.name} is offered first when you start a reading.`
              : undefined
          }
          control={
            <DeckSelect
              labelId="deck-label"
              value={profile.default_deck_id}
              decks={decks.map((d) => ({ id: d.id, name: d.name }))}
            />
          }
        />
        <SettingsRow
          label="Reversals"
          labelId="reversals-label"
          description={
            (profile.use_reversals
              ? 'On: a card can be drawn or entered upside down. '
              : 'Off: every card is read upright. ') +
            (noReversalDecks.length ? `${noReversalDecks.join(', ')} never uses reversals.` : '')
          }
          control={<ReversalsToggle labelId="reversals-label" enabled={profile.use_reversals} />}
        />
      </SettingsSection>

      <SettingsSection title="AI & privacy">
        <SettingsRow
          label="AI interpretation"
          labelId="consent-label"
          description={
            consented
              ? 'On. Readings can be sent to a model for interpretation. Turn off any time.'
              : 'Off. Your journal works fully without it; nothing is sent to a model.'
          }
          control={<ConsentToggle labelId="consent-label" granted={consented} />}
        />
        <SettingsRow
          label="Explanation depth"
          labelId="depth-label"
          description="How much a card gets explained alongside a reading."
          control={<DepthSelect labelId="depth-label" value={profile.ai_explanation_depth} />}
        />
        <SettingsRow
          label="Delete AI artifacts"
          description="Remove every interpretation and suggestion, keep your own words."
          comingIn="Phase 05"
        />
      </SettingsSection>

      <SettingsSection title="Reminders">
        <SettingsRow
          label="Revisit a reading"
          description="Specific, content-anchored, never a streak."
          comingIn="Phase 11"
        />
      </SettingsSection>

      <SettingsSection title="Subscription">
        <SettingsRow
          label="Plan"
          description="Free. Your archive stays readable whatever the plan."
          comingIn="Phase 11"
        />
      </SettingsSection>

      <SettingsSection title="Export & delete" description="Always two taps away.">
        <SettingsRow
          label="Export everything"
          description="A complete copy of your journal, in a readable format."
          comingIn="Phase 05"
        />
        <SettingsRow
          label="Delete account"
          description="Removes everything, including derived data."
          comingIn="Phase 12"
        />
      </SettingsSection>

      <SettingsSection title="About & policies">
        <SettingsRow
          label="Privacy policy"
          control={
            <Link href="/privacy" className="text-sm text-accent underline underline-offset-4">
              Read
            </Link>
          }
        />
        <SettingsRow label="Tarot Journal" description="Reflection, not prediction." />
      </SettingsSection>
    </>
  );
}
