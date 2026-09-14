# Design System & UX Rules

The product's credibility comes from feeling like a private, well-made journal — not like an AI demo.
This document is binding: every phase's UX acceptance criteria refer back to it.

## Experience principles (§4, restated as rules you can fail a review on)

1. **Capture first, organise automatically.** No screen may require the user to tag, classify, choose a
   life area, or create a journey/entity before saving. Any field that is not strictly required is
   skippable in one tap.
2. **Conclusion before detail.** Every AI surface opens with one plain-language sentence. Evidence and
   depth live beneath it, behind progressive disclosure.
3. **Never an analytics dashboard.** Narrative timelines and at most one or two meaningful visuals per
   screen. No dense chart grids, no vanity counters.
4. **Inferred is always labeled.** Model-derived content carries a consistent visual treatment and the
   word "suggested"/"possible", plus a one-tap way to correct or dismiss it, plus "why am I seeing
   this?" that shows the actual reasons.
5. **The user's voice is visually first-class.** User notes use a distinct treatment from AI text (see
   below) and are never restyled, summarised over, or overwritten.
6. **Ownership feels real.** Export and delete are reachable in two taps from Profile, plainly worded.
7. **No compulsion.** No streak counters, no badges, no "your reading is waiting" nags, no
   variable-reward animations. Reminders are specific and content-anchored ("you asked about the job
   offer 30 days ago") and always mutable in one tap.
8. **Value before paywall.** The first reading, its interpretation and its saved timeline entry all
   happen before any payment surface appears.

## Visual language

Aim: quiet, tactile, a little nocturnal. Paper and ink rather than neon mysticism; the cards provide
the drama, the interface stays calm.

```
Surface    deep ink backgrounds in dark, warm off-white paper in light
Accent     a single restrained accent per deck system (RWS: warm gold; Thoth: cool violet)
           — the accent is how the user feels which deck they are in, without a badge shouting it
Type       one serif for reading/journal content (editorial, readable at length)
           one geometric sans for UI chrome, labels and numbers
Density    generous line-height in content, compact in chrome; 4pt spacing scale
Corners     soft but not pill-shaped; cards 12px, controls 8px
Elevation  near-flat; separation by tone and hairline, not by heavy shadow
Motion      150–250ms, ease-out; card reveal is the only "delightful" animation
```

Tokens live in `src/ui/tokens.css` as CSS custom properties with a full light palette on `:root`,
redefined under `@media (prefers-color-scheme: dark)` and `[data-theme]`. No component hard-codes a
colour. Deck accent is a token set swapped by a `data-deck` attribute.

### Distinguishing user text from AI text

A consistent, learnable contract used on every screen:

| | User content | AI content |
|---|---|---|
| Typeface | content serif | UI sans |
| Ground | paper/plain, no container | subtly tinted container with a hairline left edge |
| Label | "Your interpretation" | "AI interpretation", collapsed by default |
| Actions | edit inline | expand · correct · dismiss · why this? |

Applied identically to inferred metadata chips, suggested links, journey narratives and summaries, so
"this is a machine's guess" is recognisable at a glance anywhere in the app.

## Mobile-first mechanics

- Design at **390px**; verify 320px does not break; scale up to a single centred column at desktop
  (max content width ~720px). No desktop-only layouts.
- Primary actions sit in thumb reach; the bottom nav is Home / Journal / Journey / Ask / Profile (§5).
- Touch targets ≥ 44×44px. No hover-only affordances.
- Sheets and drawers instead of modals for anything content-related; a modal only for destructive
  confirmation.
- Long content lists are virtualised and paginated; the journal must scroll at 60fps with 1000 entries.

## Accessibility (§13, non-negotiable)

- Full keyboard operability of every flow including the card picker and the draw animation.
- Semantic landmarks and headings; every control has an accessible name; card images have meaningful
  alt text (deck-native card name + orientation).
- WCAG AA contrast for text and interactive elements; verified with axe in E2E.
- Respect `prefers-reduced-motion`: shuffle and reveal degrade to an instant state change.
- Text scales to 200% without clipping or horizontal scroll.
- Screen-reader announcements for streaming AI output (polite live region), not a silent shifting page.
- Never convey meaning by colour alone — inferred vs confirmed also differs by label and icon.

## Loading, empty and error states

Every async surface needs all four states designed, and each phase's review checks them:

- **Skeleton** that matches final layout (§13: show state immediately, AI may stream).
- **Streaming** with a visible, cancellable progress affordance and partial text rendered as it arrives.
- **Empty** states that teach the next useful action in one sentence, never a shrug. (Journal empty:
  "Your readings will collect here. The first one is the start of your timeline.")
- **Error** states that are honest and recoverable: "Interpretation unavailable — your reading is
  saved. Retry?" Content loss is never an acceptable failure mode.

## Copy rules

- Second person, plain, unhurried. No mystical grandiosity, no hype, no emoji in product chrome.
- Hedged for anything interpretive: "suggests", "may point to", "one way to read this".
- Never imply certainty about the future, never quote a probability, never claim accuracy statistics.
- High-stakes topics (medical, legal, financial, self-harm, safety): keep the reflection, add a calm,
  non-preachy pointer to qualified help, once, not repeatedly (§10).
- Error copy says what happened, what is safe, and what to do next — in that order.

## Component inventory (built in Phase 00, extended per phase)

`AppShell` · `BottomNav` · `PageHeader` · `Card` (tarot card render, art or typographic treatment,
orientation-aware) · `CardPicker` (fast deck-native search-select for physical entry) · `SpreadLayout`
· `ShuffleReveal` · `LayeredInterpretation` · `SafetyResourceCard` · `UserNoteEditor` · `InferredChip` · `EvidenceList` ·
`JourneyTimeline` · `ThemeProgression` · `RecurringSymbols` ·
`SourceCitation` · `TimelineItem` · `JourneyTimeline` · `ThemeProgression` · `ConfidenceBadge` ·
`ConnectionProposal` (confirm/maybe/unrelated) · `OutcomeSelector` · `AskComposer` · `AnswerWithSources`
· `PaywallSheet` · `EmptyState` · `Skeleton` · `ErrorState` · `ConfirmDestructive`.

Each ships with a story/preview route under `/dev/ui` (dev-only), light + dark, and an axe check.

Phase 02 built `Card`, `CardPicker`, `SpreadLayout` (plus `CardDetail` and `DeckBrowser` for the
reference pages). `Card` renders bundled art through a `<picture>` with AVIF/WebP srcsets or, when
a row has no `art_asset_path`, the **typographic face**: a per-size em-scaled composition of
numeral/rank, deck-native name and title, suit glyph, element sigil, Hebrew letter and astrological
glyphs inside a double hairline frame on a radial accent-soft ground. It is the Thoth deck's
first-class rendering, not a placeholder (see [LICENSING.md](LICENSING.md)). Reversal is shown by
rotation **and** a visible "Reversed" chip; alt text is always deck-native
("Lust — Thoth", "Strength, reversed — Rider–Waite–Smith").

Phase 03 built `ShuffleReveal` (card backs shuffle for ~1.1 s, then each card turns face-up into
its slot with a 380 ms stagger; one tap or Enter skips; instant under reduced motion; orientation
announced in a polite live region), `CardEntry` (physical entry: layout with the active slot, one
row per position with a labelled `aria-pressed` Reversed toggle, move up/down and remove, and the
`CardPicker` focused underneath — a three-card reading is three searches and three Enters),
`UserNoteEditor` (the user's words in the content serif on plain ground, autosaving after a
pause and on blur with a Saving/Saved/could-not-save status line; a failed save never touches the
text), `ReadingDetail` (§6.3 sections in order; the AI slot is an honest "Not generated" in the
tinted container until Phase 04) and `LocalTime` (server renders UTC, the browser re-renders in
its own zone). `ChoiceButton`'s selected state is now an outline + soft accent ground — the
`hairline` utility owns `box-shadow`, so a Tailwind ring is invisible on it; use outlines for
selection on hairlined surfaces. `FocusHeading` takes `autoFocus={false}` when a step's own control
(the picker) should receive focus.

Phase 04 built `LayeredInterpretation` (the AI container contract made concrete: UI sans in the
tinted `surface-ai` container with a 2px hairline left edge, an eyebrow "AI interpretation ·
suggested, one way to read this", the synthesis always visible, then *Card by card*, *Read
together* and *Questions to sit with* as native `<details>` layers — keyboard-operable by
construction, folded by default for `experienced` readers — a polite `role="status"` live region
that announces **stages** ("Synthesis ready.", "Card 2 of 3.", "Interpretation complete."), never
tokens, a `▍` caret on the string still arriving, a *stale* notice when the cards changed since,
a "Why am I seeing this?" disclosure with model and prompt version, and an `actions` slot),
`SafetyResourceCard` (§10: heading, one calm paragraph, resources as links or numbers with their
region; shown once per reading above the interpretation; `data-safety-card` for tests) and the
client island `InterpretationPanel` (`app/(app)/reading/[id]/`): states are *off* (no consent —
plain copy and a link to Profile), *idle* ("Not generated." + "Generate interpretation"),
*streaming* (skeleton → layers, Stop), *in progress elsewhere* (polls), *failed* ("Interpretation
unavailable — your reading is saved." + what happened + Try again, partial layers kept) and
*stored* (feedback Yes / Not really with an optional reason, Regenerate). The reading flow's
question step gained the FR-25 nudge: a region "You've asked this a few times today." listing the
earlier readings, *Draw anyway* (primary) and *Look at what's driving the uncertainty*.

Phase 05 built `TimelineItem` (one reading on the journal: date, question or *Open reflection*,
deck accent as a left rule, spread and source, up to five `xs` card thumbnails then *+N*, the
deck-native card names, one preview line — the AI synthesis labelled *AI ·* in the tinted sans
container, or the user's note in the serif — and status chips; `content-visibility: auto` so a
1000-entry list scrolls at 60fps; matched cards from a search get an outline and an underlined
name), `NoteHistory` (the earlier versions of the user's question and notes as a folded
`<details>`, serif on paper because the words are theirs), the journal's `JournalFilters` (a
GET form: search box, a *Filters* disclosure with date range, deck, spread, source, follow-up,
notes, AI and sort; selects apply on change; every state lives in the URL; *Clear all* is one
link) and `JournalList` (month headings that regroup in the viewer's zone after mount, a polite
`role="status"` result count, cursor pagination by sentinel with a *Load more* fallback), the
edit form's deck and spread selects (a deck change clears the cards with an honest notice; the
stored interpretation is *stale*, never silently kept), the delete confirmation that names
exactly what goes, and the Profile's `ExportControls` (button, history with status, size,
expiry and *Download*), `DeleteAiArtifactsControl` (counts quoted before the destructive verb)
and `DeletionReceipts`.

Phase 06 built the reading detail's **Connections** panel (`MemoryPanel`, `app/(app)/reading/[id]/`):
the AI container contract again — UI sans in `surface-ai` with a hairline left edge and the
eyebrow "Suggested by AI · one way to sort this reading" — holding the structured memory a
reading grew as groups of chips: *Life area*, *Themes*, *People and places*, *Possibilities*,
*Timeframe*. Every model-derived value is an `InferredChip` (now with a `label` of
"suggested" or "possibly" for tentative matches, a "keep" action and a configurable correct
label); "why?" opens the actual reasons ("You have called them “Alex” before", "Alex is your
partner", "Last mentioned 12 days apart"); a value the user set, kept or linked becomes a solid
`UserChip` labelled "you" with an undo. Corrections are inline — a life-area `<select>`, an
add-theme field, an entity picker `<select>` ("This is right — keep it", the user's other
entries, "Someone new"), an edit field for a possibility or timeframe — never a modal. An open
disambiguation renders as a small `role="group"` question ("Which Alex is this?") with one button
per candidate (with their roles), *Someone else* and *not a person*. States: *not sorted* (AI
off — plain copy and a link to Profile), *looking* (a polite status while the queued job runs;
the panel polls the memory route every 3 s for up to two minutes), *ready*, *stale* (an earlier
version of the reading was read; refreshes after the next pass), *failed* ("Couldn’t sort this
reading. Your words are unchanged" + *Try again*, which only queues). "Why am I seeing this?"
names the model, prompt and schema versions. Every outcome is announced in a polite live region.

Also built: the **People & places** pages (`/profile/entities`, `/profile/entities/[id]`): a
list grouped by kind with "suggested" / "confirmed by you", active roles, name and reading counts,
first/last seen; a detail page with rename (confirms), the user's own note (serif — theirs),
aliases as chips (dashed = suggested, solid = yours, removable), roles over time with start/end
dates and *ended today*, an add-role form, every mention linked to its reading with a "Why this
was matched" disclosure, and the corrections — merge into another entry (the one destructive
confirmation names what moves and that it can be undone; the target page shows an undo notice),
split off mentions (checkboxes + a name), remove. The journal's filter panel gained *Mentions*
(an entity select, only when the user has entities).

Phase 07 built the **Journey** screens (`app/(app)/journey/`, the product's centrepiece, §6.5).
The list: the one suggestion as a dashed `bg-surface-ai` card ("Possibly a journey" · *Keep it
as a journey* / *Not a journey* — dismissal is for good, and any further suggestions wait,
"offered one at a time"), then *Ongoing*, then *Quiet or closed*, each row with reading
count, start date and "gathered automatically" until the user touches it; *Start a journey
yourself* is always there (invariant 10 cuts both ways). The detail, eight sections in the
spec's order, every one with a real empty state: a deterministic **narrative header** in the
page description ("3 readings and no confirmed outcomes yet since April, across both decks.
3 readings are still open."); the **timeline** (`JourneyTimeline`: month `<h3>` headings that
stick, one `<ol>` per month, each reading an `<article data-deck>` with its deck's accent and
deck-native card names, a follow-up chip, "gathered here — suggested" or "here because you
said so", and inline *keep* / *remove* — a removal is announced and offered back in an undo
bar above the timeline, so it survives the item disappearing); pending suggestions in a
"Might belong here" block with *Yes, part of this* / *No*; **theme progression**
(`ThemeProgression`: a `sr-only` sentence "The themes moved from uncertainty, then
conflict…", then a wrapped `<ol>` of `<details>` steps with arrows, each opening to its
source readings — never a chart); **recurring symbols** (`RecurringSymbols`: `<details>` rows
labelled with kind and deck — "card · Thoth" — a context sentence and the source readings);
**open loops** (linked cards); **confirmed outcomes** and **possible connections** (filled in
Phase 08, below); **Ask about this journey** as a disabled button "coming soon";
and **Manage**: rename (the hint says whether the title is a placeholder, a suggestion or
yours; renaming pins it), close/reopen, a journal link, merge (a `<select>` + the destructive
confirmation, undo from the target's notice), split (checkboxes + a name), delete (names what
stays). On the reading detail, **Connections** gained a *Journeys* row: a solid "you" chip, an
`InferredChip` "suggested" with why / keep / ×, or the inline question "Part of *X*?" with
*Yes* / *No*, plus *Add to a journey* (a select, or a new one). Home's *Worth a look* shows
the single suggestion card. The journal's filter panel gained *Journey*.

**Phase 08 — events, connections, outcomes.** *Something happened* is one tap from Home,
the Journal header and every reading (the reading's version pre-links). The entry form
(`EventForm`) is a sentence and a date on screen, a note and a photo folded under one
disclosure, nothing about tarot — the hint says "No need to mention a reading"; the photo
control is a labelled `<input type=file>` and asks for a description of the picture. The
event detail (`/event/[id]`) is the sentence as the `h1`, the date, the inferred type as a
word ("home — suggested"), the photo (owner-scoped signed URL through `/api/events/media/`),
then **Connections to readings**: the review island (`ConnectionReview`) renders at most
three dashed `bg-surface-ai` cards, each with the band *in words* ("Likely connection ·
inferred" / "Possible connection · inferred"), the reading's question, date, spread, deck
and every card under its own deck's name, the AI sentence when one arrived (marked "AI
wording of the reasons below"), the actual reasons as chips, a `<details>` "Why am I seeing
this?" with the signal table in words (strong / some / faint / none — never a number), and
three buttons *Confirm* / *Maybe* / *Unrelated* in a `role=group` named after the reading.
Every decision shows an undo bar; decided cards move under **Decided** as "Connected — you
confirmed it" / "Maybe — you left it open" / "Unrelated — you said so" with *Change my
mind*. Zero results say so: "No connection found. That is a normal result — not everything
relates to a reading." While the jobs run the screen says "Looking through your past
readings…" and refreshes itself a dozen times, then stops. The event list (`/event`) is
month-grouped like the journal, each row saying whether it is connected. On the reading
detail, **Follow-up** gained the `OutcomePanel`: five status chips (*It happened · Partly ·
It did not happen · Still unresolved · No longer relevant*), then an optional note and an
optional life event (none / log one now / pick an existing one), a *Record* button, the
current record shown as "What happened · you, <date>" with earlier records under a
disclosure, per-possibility selects, and the *Something happened about this* button;
**Connections** gained a *Life events* row with the same review island (the event on the
other side). Home shows **You asked to come back to this**: overdue revisits as calm,
content-anchored cards ("You asked about this 32 days ago — what happened? Say so when you
know; no rush.") that clear when an outcome is recorded — never a count of missed days,
never a badge. The journey detail's timeline interleaves life events (a solid left border,
"life event") and outcomes ("what happened") with the readings; **Confirmed outcomes**
lists the user's records with the reading they answer and "Connections you confirmed";
**Possible connections** shows the pending and maybe links with the same review cards; an
event asked about appears under "Might belong here" like a pending reading. The journey
list says "4 readings · 3 life events".


Phase 11 built the money and reminder surfaces without a single wall. **`PremiumOffer`**
(`src/ui/components/premium-offer.tsx`) is the one paywall, in two skins: `PaywallCard`, an
inline section that stands *where the premium control would be* (Ask's composer for a free
user), and `PaywallSheet`, a Radix Dialog opened by the control itself (the retrospective's
"Write a summary (Premium)", the journey's "Rewrite the header (Premium)", Profile's "See
Premium") — never on page load, never as an interstitial. It leads with the value sentence for
*this* context ("Ask my history searches all 84 of your readings and answers with sources."),
lists what Premium adds in four lines, offers the yearly price first (with its per-month
equivalent and the saving) and the monthly price second as radio rows, states the trial's
end date as a real date in real text, says cancellation is one tap from Profile, and ends
with what still works — the line about the archive is on every variant. Its buttons say
"Start 14 days free" / "Subscribe for a year" / "Not now"; the sheet traps focus, closes on
Escape and returns focus to the control. A used-up allowance is not a wall either: the
interpretation slot says "No new interpretation this time — your reading is saved." with the
exact count, what stays readable, and a *See what Premium adds* link. Profile's
**Subscription** section is one sentence with real dates ("Premium trial until 28 September
2026. The yearly price starts then unless you cancel before.") plus the allowance used, and
one control: *Manage billing* (the provider's portal) or *See Premium*. The fake provider's
checkout and portal pages (`/billing/checkout`, `/billing/portal`) use the same components
and say plainly that nothing is charged.

Profile's **Reminders** section names the channel (Off / Email / Push with email as the
fallback), a *Push on this device* control that asks the browser once, three switches each
describing exactly when it fires ("Only when you set a revisit date on a reading and it has
passed."), quiet hours as two time inputs, and *Recent reminders* as links. Copy rules for
reminders are enforced by test: no streak, loss, hurry or "come back" vocabulary, and no
entry's words. `/notifications/unsubscribed` is the one-tap landing: "Turned off." and the
way back.

**`ShareStudio`** (`src/ui/components/share-studio.tsx`) is the FR-24 surface: a fieldset of
opt-ins that each name what they reveal ("Names this reading mentions: Maya, the agency."), a
`<figure>` whose `<img>` *is* the server-rendered card with the caption "This is the exact
image. Nothing else is added when you share it.", and *Share…* (Web Share API with the file)
/ *Download image*. The card itself (`src/share/render.tsx`, 1080 × 1350) is the dark
palette from `tokens.css` drawn with Newsreader and DM Sans: eyebrow with the deck's accent
dot, the date, the question only if chosen, the cards in position (RWS art, or the
typographic face for Thoth with its own numeral and name), theme chips, and the footer
"Reflection, not prediction." The month card leads with the month in large serif, three
plain numbers, "Kept coming back", and theme chips. Colours for the image are the one
sanctioned literal set in `src/ui/theme-colors.ts` (`SHARE_PALETTE`).
