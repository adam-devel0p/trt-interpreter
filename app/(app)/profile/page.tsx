import Link from 'next/link';
import { redirect } from 'next/navigation';
import { signOutAction } from '@/auth/actions';
import { getSessionClient, requireUser } from '@/auth/session';
import { listDecks } from '@/db/queries/decks';
import { listDeletionReceipts, listExports } from '@/db/queries/exports';
import { getProfile, hasAiConsent } from '@/db/queries/profile';
import { getRetentionSettings } from '@/db/queries/summaries';
import { countAiArtifacts } from '@/privacy/aiArtifacts';
import { Button } from '@/ui/components/button';
import { PageHeader } from '@/ui/components/page-header';
import { SettingsRow, SettingsSection } from '@/ui/components/settings';
import { ConsentToggle, DeckSelect, DepthSelect, ReversalsToggle } from './controls';
import { DeleteAiArtifactsControl, DeletionReceipts, ExportControls } from './privacy-controls';
import { RetentionToggle } from './retention-controls';

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
  const [profile, decks, exports, receipts, artifactCounts, retention] = await Promise.all([
    getProfile(client, user.id),
    listDecks(client),
    listExports(client, 5),
    listDeletionReceipts(client, 5),
    countAiArtifacts(client, user.id),
    getRetentionSettings(client),
  ]);
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
          label="People & places"
          description="Who and what your readings mention, as the app has sorted them. Correct, merge or split any entry."
          control={
            <Link
              href="/profile/entities"
              className="text-sm text-accent underline underline-offset-4"
            >
              Open
            </Link>
          }
        />
        <SettingsRow
          label="Delete AI artifacts"
          description="Remove every interpretation and suggestion, keep your own words."
          control={<DeleteAiArtifactsControl counts={artifactCounts} />}
        />
      </SettingsSection>

      <SettingsSection
        title="Looking back"
        description="What Home may resurface, one thing at a time. Each is optional and dismissible; there are no streaks."
      >
        <SettingsRow
          label="An old reading on this day"
          labelId="retention-on-this-day-label"
          description="The same day a year or more ago, or thirty days ago. At most one a day."
          control={
            <RetentionToggle
              labelId="retention-on-this-day-label"
              settingKey="on_this_day"
              enabled={retention.on_this_day}
            />
          }
        />
        <SettingsRow
          label="Unresolved questions"
          labelId="retention-unresolved-label"
          description="When you have asked about the same thing three times without saying what happened — an invitation to reflect, not to draw again."
          control={
            <RetentionToggle
              labelId="retention-unresolved-label"
              settingKey="unresolved_review"
              enabled={retention.unresolved_review}
            />
          }
        />
        <SettingsRow
          label="Journey shifts"
          labelId="retention-shifts-label"
          description="When a journey's themes actually move. Once per shift."
          control={
            <RetentionToggle
              labelId="retention-shifts-label"
              settingKey="journey_shifts"
              enabled={retention.journey_shifts}
            />
          }
        />
        <SettingsRow
          label="Monthly look-back"
          labelId="retention-retro-label"
          description="A month with enough in it to look back on."
          control={
            <RetentionToggle
              labelId="retention-retro-label"
              settingKey="retrospectives"
              enabled={retention.retrospectives}
            />
          }
        />
        <SettingsRow
          label="Reminders by email or push"
          description="Revisit a reading, weekly reflection — specific, content-anchored, never a streak."
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

      <div id="export" className="scroll-mt-4">
        <SettingsSection title="Export & delete" description="Always two taps away.">
          <ExportControls exports={exports} />
          <SettingsRow
            label="Delete account"
            description="Removes everything, including derived data."
            comingIn="Phase 12"
          />
          <DeletionReceipts receipts={receipts} />
        </SettingsSection>
      </div>

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
