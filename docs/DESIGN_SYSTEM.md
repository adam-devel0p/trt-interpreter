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
· `ShuffleReveal` · `LayeredInterpretation` · `UserNoteEditor` · `InferredChip` · `EvidenceList` ·
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
