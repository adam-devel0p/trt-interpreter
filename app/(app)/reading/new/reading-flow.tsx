'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import * as React from 'react';
import type { DeckRow, PickerCard, SpreadView } from '@/db/queries/decks';
import * as D from '@/domain/readings/draft';
import type { DrawnCard, DrawRecord } from '@/domain/readings/draw';
import { LIFE_AREAS, QUESTION_MAX, NOTES_MAX, type ReadingSource } from '@/domain/readings/types';
import { MAX_BACKDATE_YEARS } from '@/domain/readings/thresholds';
import { Button } from '@/ui/components/button';
import { Card } from '@/ui/components/card';
import { CardEntry } from '@/ui/components/card-entry';
import { ChoiceButton } from '@/ui/components/choice-button';
import { FormMessage } from '@/ui/components/field';
import { FocusHeading } from '@/ui/components/focus-heading';
import { LocalTime } from '@/ui/components/local-time';
import { ShuffleReveal } from '@/ui/components/shuffle-reveal';
import { cn } from '@/ui/lib/cn';
import { drawCardsAction, saveDraftAction, saveReadingAction } from '../actions';
import { VoiceInput } from './voice-input';

export interface FlowDeck {
  deck: DeckRow;
  cards: PickerCard[];
  recentIds: string[];
}

export interface ReadingFlowProps {
  decks: FlowDeck[];
  spreads: SpreadView[];
  defaults: { deckId: string | null; source: ReadingSource; useReversals: boolean };
  serverDraft: D.ReadingDraft | null;
  /** AI consent on: the question is checked for repeats before drawing (FR-25). */
  repeatCheck: boolean;
}

const STORAGE_KEY = 'tarot-journal:reading-draft';
const SERVER_DRAFT_DEBOUNCE_MS = 1200;

const STEP_TITLE: Record<D.FlowStep, string> = {
  question: 'What are you asking?',
  life_area: 'Is this about a part of life?',
  spread: 'Choose a spread',
  deck: 'Which deck?',
  source: 'How are you drawing?',
  cards: 'Your cards',
  notes: 'What do you notice?',
};

/**
 * The seven-step creation flow (§6.2) over the pure draft machine. Each step is one thumb
 * action; the optional ones skip in one tap. The draft lives in sessionStorage from the first
 * keystroke and on the server from the first card, so a refresh, a backgrounded tab or a dead
 * battery resumes here. `data-deck` on the root follows the chosen deck so the accent changes
 * the moment a deck is picked.
 */
export function ReadingFlow({
  decks,
  spreads,
  defaults,
  serverDraft,
  repeatCheck,
}: ReadingFlowProps) {
  const router = useRouter();
  const defaultDeck = decks.find((d) => d.deck.id === defaults.deckId) ?? decks[0] ?? null;
  const [draft, setDraft] = React.useState<D.ReadingDraft | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Restore: sessionStorage (this tab) wins over the server draft (another device / dead tab).
  React.useEffect(() => {
    let restored: D.ReadingDraft | null = null;
    try {
      restored = D.restoreDraft(window.sessionStorage.getItem(STORAGE_KEY));
    } catch {
      restored = null;
    }
    restored ??= serverDraft;
    // A restored draft must still point at decks/spreads that exist.
    if (restored) {
      if (restored.deck_id && !decks.some((d) => d.deck.id === restored!.deck_id)) restored = null;
      else if (restored.spread_id && !spreads.some((s) => s.id === restored!.spread_id))
        restored = null;
    }
    setDraft(
      restored ??
        D.newDraft({
          deck: defaultDeck?.deck ?? null,
          source: defaults.source,
          useReversals: defaults.useReversals,
        }),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist every change to this tab; and, once a card exists, to the server (debounced).
  const serverTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  React.useEffect(() => {
    if (!draft) return;
    try {
      window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
    } catch {
      /* private mode or quota: the server draft still covers it */
    }
    if (!D.hasCards(draft)) return;
    if (serverTimer.current) clearTimeout(serverTimer.current);
    serverTimer.current = setTimeout(() => void saveDraftAction(draft), SERVER_DRAFT_DEBOUNCE_MS);
    return () => {
      if (serverTimer.current) clearTimeout(serverTimer.current);
    };
  }, [draft]);

  if (!draft) {
    return (
      <div role="status" aria-label="Loading" className="pt-4">
        <div className="h-4 w-24 animate-pulse rounded-control bg-surface-2" />
        <div className="mt-4 h-8 w-3/4 animate-pulse rounded-control bg-surface-2" />
      </div>
    );
  }

  const update = (fn: (d: D.ReadingDraft) => D.ReadingDraft) => {
    setError(null);
    setDraft((d) => (d ? fn(d) : d));
  };
  const activeDeck = decks.find((d) => d.deck.id === draft.deck_id) ?? defaultDeck;
  const activeSpread = spreads.find((s) => s.id === draft.spread_id) ?? null;
  const n = D.stepIndex(draft.step) + 1;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const input = D.toCreateInput(draft);
      const res = await saveReadingAction(input);
      if (!res.ok) {
        setError(res.message);
        return;
      }
      try {
        window.sessionStorage.removeItem(STORAGE_KEY);
      } catch {
        /* ignore */
      }
      router.push(`/reading/${res.value.id}?saved=1`);
    } catch {
      setError("That didn't save. Nothing you entered is lost — try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div data-deck={activeDeck?.deck.system ?? 'rws'} className="flex min-h-[70dvh] flex-col pt-4">
      <p className="mb-3 text-xs font-medium tracking-wide text-fg-muted uppercase">
        Step {n} of {D.FLOW_STEPS.length}
        {activeDeck ? (
          <span className="tracking-normal normal-case"> · {activeDeck.deck.name}</span>
        ) : null}
      </p>
      <FocusHeading
        key={draft.step}
        // Physical entry lands straight in the picker (§19: under a minute); its label names the
        // position, so nothing is lost for screen readers.
        autoFocus={!(draft.step === 'cards' && draft.source === 'physical')}
      >
        {STEP_TITLE[draft.step]}
      </FocusHeading>

      <div className="mt-5 flex flex-1 flex-col">
        {draft.step === 'question' ? (
          <QuestionStep draft={draft} update={update} repeatCheck={repeatCheck} />
        ) : draft.step === 'life_area' ? (
          <LifeAreaStep draft={draft} update={update} />
        ) : draft.step === 'spread' ? (
          <SpreadStep draft={draft} update={update} spreads={spreads} />
        ) : draft.step === 'deck' ? (
          <DeckStep
            draft={draft}
            update={update}
            decks={decks}
            useReversals={defaults.useReversals}
          />
        ) : draft.step === 'source' ? (
          <SourceStep draft={draft} update={update} />
        ) : draft.step === 'cards' && activeDeck && activeSpread ? (
          <CardsStep draft={draft} update={update} deck={activeDeck} spread={activeSpread} />
        ) : draft.step === 'notes' ? (
          <NotesStep draft={draft} update={update} onSave={save} saving={saving} />
        ) : null}
      </div>

      {error ? (
        <FormMessage tone="error" className="mt-4">
          {error}
        </FormMessage>
      ) : null}

      <div className="mt-6 flex items-center justify-between">
        {D.prevStep(draft.step) ? (
          <Button type="button" variant="ghost" onClick={() => update((d) => D.back(d))}>
            Back
          </Button>
        ) : (
          <span />
        )}
        {draft.step === 'cards' ? (
          <Button
            type="button"
            size="lg"
            disabled={!D.canAdvance(draft)}
            onClick={() => update((d) => D.advance(d))}
          >
            Continue
          </Button>
        ) : null}
      </div>
    </div>
  );
}

type StepProps = {
  draft: D.ReadingDraft;
  update: (fn: (d: D.ReadingDraft) => D.ReadingDraft) => void;
};

interface RepeatPrior {
  id: string;
  question: string | null;
  occurred_at: string;
  spread: { name: string };
}

/** Repeated-question check timing: never make the person wait on it (§10). */
const REPEAT_CHECK_TIMEOUT_MS = 2500;

function QuestionStep({ draft, update, repeatCheck }: StepProps & { repeatCheck: boolean }) {
  const id = 'reading-question';
  const [checking, setChecking] = React.useState(false);
  const [nudge, setNudge] = React.useState<RepeatPrior[] | null>(null);
  const checkedFor = React.useRef<string | null>(null);

  const advance = () => update((d) => D.advance(d));

  /**
   * FR-25: on Continue, ask the server whether this question has been asked a few times today.
   * Consent-gated on the server as well; any failure or delay simply continues.
   */
  const continueWithCheck = async () => {
    const question = draft.question.trim();
    if (!repeatCheck || !question || checkedFor.current === question) {
      advance();
      return;
    }
    setChecking(true);
    checkedFor.current = question;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REPEAT_CHECK_TIMEOUT_MS);
    try {
      const res = await fetch('/api/readings/repeat-check', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question }),
        signal: controller.signal,
      });
      const body = (await res.json()) as { nudge?: boolean; priorReadings?: RepeatPrior[] };
      if (body.nudge && body.priorReadings?.length) {
        setNudge(body.priorReadings);
        return;
      }
    } catch {
      /* fail soft */
    } finally {
      clearTimeout(timer);
      setChecking(false);
    }
    advance();
  };

  if (nudge) {
    return (
      <div role="region" aria-labelledby="repeat-h" className="flex flex-1 flex-col gap-4">
        <div className="rounded-card bg-surface p-4 hairline">
          <p id="repeat-h" className="font-medium">
            You’ve asked this a few times today.
          </p>
          <p className="mt-1 text-sm text-fg-muted">
            Another draw is always yours to take. It can also help to look at what is driving the
            uncertainty — your earlier readings on this are here.
          </p>
          <ul className="mt-3 flex flex-col gap-2 text-sm" aria-label="Earlier readings">
            {nudge.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/reading/${r.id}`}
                  className="text-accent underline underline-offset-4"
                >
                  {r.question ?? 'Open reflection'} · {r.spread.name}
                </Link>
                <span className="text-fg-muted">
                  {' '}
                  · <LocalTime iso={r.occurred_at} />
                </span>
              </li>
            ))}
          </ul>
        </div>
        <Button type="button" size="lg" className="w-full" onClick={advance}>
          Draw anyway
        </Button>
        <Button asChild variant="secondary" className="w-full">
          <Link href={`/reading/${nudge[0]!.id}`}>Look at what’s driving the uncertainty</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={id} className="text-sm font-medium">
          Your question
        </label>
        <textarea
          id={id}
          value={draft.question}
          rows={3}
          maxLength={QUESTION_MAX}
          autoFocus
          enterKeyHint="next"
          placeholder="Anything on your mind. It can be a sentence, a name, a worry."
          onChange={(e) => update((d) => D.setQuestion(d, e.target.value))}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && D.canAdvance(draft) && !checking) {
              e.preventDefault();
              void continueWithCheck();
            }
          }}
          className="prose-content w-full rounded-control bg-surface px-3 py-2 text-fg hairline placeholder:text-fg-faint"
        />
        <VoiceInput onText={(t) => update((d) => D.setQuestion(d, `${d.question} ${t}`.trim()))} />
      </div>
      <Button
        type="button"
        size="lg"
        className="w-full"
        disabled={!D.canAdvance(draft) || checking}
        onClick={() => void continueWithCheck()}
      >
        {checking ? 'One moment…' : 'Continue'}
      </Button>
      <Button
        type="button"
        variant="secondary"
        className="w-full"
        onClick={() => update((d) => D.advance(D.setOpenReflection(d)))}
      >
        Open reflection — no question
      </Button>
    </div>
  );
}

function LifeAreaStep({ draft, update }: StepProps) {
  return (
    <div className="flex flex-1 flex-col gap-4">
      <p className="text-sm text-fg-muted">
        Optional. Tap one, or skip — you can always add it later.
      </p>
      <div role="group" aria-label="Life area" className="flex flex-wrap gap-2">
        {LIFE_AREAS.map((a) => (
          <button
            key={a.key}
            type="button"
            aria-pressed={draft.life_area === a.key}
            onClick={() => update((d) => D.advance(D.setLifeArea(d, a.key)))}
            className={cn(
              'min-h-11 rounded-chip px-4 text-sm font-medium transition-colors',
              draft.life_area === a.key
                ? 'bg-accent text-on-accent'
                : 'bg-surface text-fg hairline hover:bg-surface-2',
            )}
          >
            {a.label}
          </button>
        ))}
      </div>
      <Button
        type="button"
        variant="secondary"
        size="lg"
        className="mt-auto w-full"
        onClick={() => update((d) => D.advance(D.setLifeArea(d, null)))}
      >
        Skip
      </Button>
    </div>
  );
}

function SpreadStep({ draft, update, spreads }: StepProps & { spreads: SpreadView[] }) {
  const builtin = spreads.filter((s) => s.is_builtin);
  const custom = spreads.filter((s) => !s.is_builtin);
  const choose = (s: SpreadView) =>
    update((d) => D.advance(D.setSpread(d, { id: s.id, card_count: s.card_count })));
  const render = (s: SpreadView) => (
    <ChoiceButton
      key={s.id}
      type="button"
      title={s.name}
      description={`${s.card_count} card${s.card_count === 1 ? '' : 's'} · ${s.description}`}
      selected={draft.spread_id === s.id}
      onClick={() => choose(s)}
    />
  );
  return (
    <div className="flex flex-col gap-3">
      {builtin.map(render)}
      {custom.length ? (
        <>
          <h2 className="mt-3 text-xs font-medium tracking-wide text-fg-muted uppercase">
            Your spreads
          </h2>
          {custom.map(render)}
        </>
      ) : null}
      <Link
        href="/reading/spread/new"
        className="mt-2 self-start text-sm text-accent underline underline-offset-4"
      >
        Create a custom spread
      </Link>
    </div>
  );
}

const PREVIEW_SLUGS: Record<string, string[]> = {
  rws: ['strength', 'the-world', 'page-of-pentacles'],
  thoth: ['lust', 'the-universe', 'princess-of-disks'],
};

function DeckStep({
  draft,
  update,
  decks,
  useReversals,
}: StepProps & { decks: FlowDeck[]; useReversals: boolean }) {
  const active = decks.find((d) => d.deck.id === draft.deck_id);
  const preview = active
    ? (PREVIEW_SLUGS[active.deck.system] ?? [])
        .map((slug) => active.cards.find((c) => c.slug === slug))
        .filter((c): c is PickerCard => Boolean(c))
    : [];
  return (
    <div className="flex flex-1 flex-col gap-4">
      <div role="group" aria-label="Deck" className="flex flex-col gap-3">
        {decks.map(({ deck }) => (
          <ChoiceButton
            key={deck.id}
            type="button"
            title={deck.name}
            description={
              deck.supports_reversals
                ? useReversals
                  ? 'Reads reversals.'
                  : 'Reversals are off in your profile.'
                : 'Read by dignity and position; no reversals.'
            }
            selected={draft.deck_id === deck.id}
            aria-pressed={draft.deck_id === deck.id}
            onClick={() =>
              update((d) =>
                D.setDeck(
                  d,
                  { id: deck.id, supports_reversals: deck.supports_reversals },
                  useReversals,
                ),
              )
            }
          />
        ))}
      </div>
      {active && preview.length ? (
        <div data-deck={active.deck.system} className="rounded-card bg-surface p-3 hairline">
          <p className="mb-2 text-xs text-fg-muted">Named as in {active.deck.name}:</p>
          <ul className="flex gap-3" aria-label={`Cards in ${active.deck.name}`}>
            {preview.map((c) => (
              <li
                key={c.id}
                className="flex min-w-0 flex-1 flex-col items-center gap-1 text-center"
              >
                <Card card={c} size="xs" />
                <span className="text-xs leading-tight">{c.name}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <Button
        type="button"
        size="lg"
        className="mt-auto w-full"
        disabled={!D.canAdvance(draft)}
        onClick={() => update((d) => D.advance(d))}
      >
        Continue
      </Button>
    </div>
  );
}

function SourceStep({ draft, update }: StepProps) {
  const choose = (source: ReadingSource) => update((d) => D.advance(D.setSource(d, source)));
  return (
    <div role="group" aria-label="Source" className="flex flex-col gap-3">
      <ChoiceButton
        type="button"
        title="Draw digitally"
        description="A short shuffle, then the cards land in their positions."
        selected={draft.source === 'digital'}
        onClick={() => choose('digital')}
      />
      <ChoiceButton
        type="button"
        title="Enter my physical cards"
        description="You drew with your own deck; type the names."
        selected={draft.source === 'physical'}
        onClick={() => choose('physical')}
      />
    </div>
  );
}

function CardsStep({
  draft,
  update,
  deck,
  spread,
}: StepProps & { deck: FlowDeck; spread: SpreadView }) {
  const [drawing, setDrawing] = React.useState(false);
  const [drawError, setDrawError] = React.useState<string | null>(null);
  const [revealDone, setRevealDone] = React.useState(false);
  const byId = React.useMemo(() => new Map(deck.cards.map((c) => [c.id, c])), [deck.cards]);

  if (draft.source === 'physical') {
    return (
      <div className="flex flex-col gap-5">
        <CardEntry
          spreadName={spread.name}
          positions={spread.positions}
          layout={spread.layout}
          cards={deck.cards}
          deckName={deck.deck.name}
          recentIds={deck.recentIds}
          placed={draft.cards}
          usesReversals={draft.uses_reversals}
          onPlace={(i, id) => update((d) => D.placeCard(d, i, id))}
          onRemove={(i) => update((d) => D.removeCard(d, i))}
          onToggle={(i) => update((d) => D.toggleOrientation(d, i))}
          onSwap={(a, b) => update((d) => D.swapCards(d, a, b))}
        />
        <BackDate
          value={draft.occurred_at}
          onChange={(v) => update((d) => D.setOccurredAt(d, v))}
        />
      </div>
    );
  }

  const drawn = D.cardsComplete(draft);
  const draw = async () => {
    setDrawing(true);
    setDrawError(null);
    const res = await drawCardsAction({
      deckId: deck.deck.id,
      count: spread.card_count,
      usesReversals: draft.uses_reversals,
    });
    setDrawing(false);
    if (!res.ok) {
      setDrawError(res.message);
      return;
    }
    const { cards, rng } = res.value as { cards: DrawnCard[]; rng: DrawRecord };
    update((d) => D.applyDraw(d, cards, rng));
  };

  if (!drawn) {
    return (
      <div className="flex flex-1 flex-col gap-4">
        <p className="text-sm text-fg-muted">
          {spread.card_count === 1 ? 'One card' : `${spread.card_count} cards`} from{' '}
          {deck.deck.name}
          {draft.uses_reversals ? ', reversals on.' : ', all upright.'} The shuffle happens on our
          side, before anything else — no model chooses your cards.
        </p>
        {drawError ? <FormMessage tone="error">{drawError}</FormMessage> : null}
        <Button
          type="button"
          size="lg"
          className="w-full"
          disabled={drawing}
          onClick={() => void draw()}
        >
          {drawing
            ? 'Shuffling…'
            : spread.card_count === 1
              ? 'Draw a card'
              : `Draw ${spread.card_count} cards`}
        </Button>
      </div>
    );
  }

  const revealed = draft.cards.map((c) => ({
    card: byId.get(c!.card_id)!,
    orientation: c!.orientation,
  }));
  return (
    <div className="flex flex-col gap-4">
      <ShuffleReveal
        key={draft.rng?.seed}
        spreadName={spread.name}
        positions={spread.positions}
        layout={spread.layout}
        cards={revealed}
        onDone={() => setRevealDone(true)}
      />
      {revealDone ? (
        <ol className="text-sm" aria-label="Drawn cards">
          {revealed.map((c, i) => (
            <li key={c.card.id} className="flex gap-2 py-0.5">
              <span className="w-5 shrink-0 text-right text-fg-muted tabular-nums">{i + 1}</span>
              <span>
                <span className="text-fg-muted">{spread.positions[i]?.name}: </span>
                <span className="font-medium">{c.card.name}</span>
                {c.orientation === 'reversed' ? (
                  <span className="text-fg-muted"> · reversed</span>
                ) : null}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

function BackDate({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (iso: string | null) => void;
}) {
  const id = 'reading-occurred-at';
  const [open, setOpen] = React.useState(value !== null);
  const min = new Date();
  min.setFullYear(min.getFullYear() - MAX_BACKDATE_YEARS);
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="self-start text-sm text-accent underline underline-offset-4"
      >
        This reading was earlier — set the date
      </button>
    );
  }
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        When was this reading?
      </label>
      <input
        id={id}
        type="datetime-local"
        value={value ? toLocalInput(value) : ''}
        min={toLocalInput(min.toISOString())}
        max={toLocalInput(new Date().toISOString())}
        onChange={(e) => onChange(e.target.value ? new Date(e.target.value).toISOString() : null)}
        className="min-h-11 w-full rounded-control bg-surface px-3 text-base hairline"
      />
      <p className="text-xs text-fg-muted">Leave it empty to use now.</p>
    </div>
  );
}

/** ISO → the `datetime-local` value format in the browser's zone. */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function NotesStep({
  draft,
  update,
  onSave,
  saving,
}: StepProps & { onSave: () => Promise<void>; saving: boolean }) {
  const id = 'reading-notes';
  return (
    <div className="flex flex-1 flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <label htmlFor={id} className="text-sm font-medium">
          What I notice
        </label>
        <textarea
          id={id}
          value={draft.user_notes}
          rows={5}
          maxLength={NOTES_MAX}
          autoFocus
          placeholder="Optional. Your first impression, in your own words — before anything else is said about it."
          onChange={(e) => update((d) => D.setNotes(d, e.target.value))}
          className="prose-content w-full rounded-control bg-surface px-3 py-2 text-fg hairline placeholder:text-fg-faint"
        />
        <p className="text-xs text-fg-muted">This stays yours. Nothing rewrites it.</p>
      </div>
      <Button
        type="button"
        size="lg"
        className="mt-auto w-full"
        disabled={saving}
        onClick={() => void onSave()}
      >
        {saving ? 'Saving…' : 'Save reading'}
      </Button>
    </div>
  );
}
