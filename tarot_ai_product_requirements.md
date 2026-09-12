**Product Requirements & Differentiation Specification**

Research-informed brief for implementation planning

Core product thesis: Do not build another AI tarot reader. Build a
private, low-friction tarot journal that turns isolated readings into an
evidence-backed personal timeline: reading → themes → life events →
outcome → evolving journey.

# 1. Executive Summary

The tarot-app market is already crowded with digital card draws, card
meanings, custom spreads, journals, physical-deck logging,
recurring-card statistics and AI interpretations. Labyrinthos alone
reports more than 1 million Google Play downloads and 43K+ reviews,
while newer products such as ArcanaLog and Arcana explicitly market
longitudinal pattern tracking and private/offline journaling.
<sup>1</sup> <sup>2</sup> <sup>3</sup>

At the same time, qualitative user feedback repeatedly criticizes
generic AI interpretations, confusing interfaces, intrusive
monetization, and the friction of manually recording physical readings.
Some tarot users explicitly prefer AI only as an interpretation aid
after they draw their own physical cards, rather than as the source of
the draw itself. <sup>4</sup> <sup>5</sup> <sup>6</sup> <sup>7</sup>

General AI journals already provide long-term memory, recurring-topic
detection, journal Q&A and story views. Therefore, generic 'AI that
remembers your journal' is not a durable differentiator. The product
must specialize the memory layer around tarot-specific longitudinal
objects: readings, cards, spread positions, possibilities/predictions,
life events, outcomes, recurring symbolic themes,
people/places/projects, and user-confirmed journeys. <sup>8</sup>
<sup>9</sup>

Subscription benchmarks also suggest that AI can improve monetization
while hurting retention if the long-term value is weak. RevenueCat's
2026 data reports higher revenue per payer for AI apps but materially
lower 12-month retention, which makes accumulated personal history and
recurring retrospective value especially important for this product.
<sup>10</sup>

## Recommended positioning

A tarot journal that remembers your readings, connects them with what
actually happens in your life, and shows how your themes evolve over
time.

The app should be equally usable by a beginner with no physical deck and
an experienced reader who wants to use their own deck. AI is an optional
interpretation and synthesis layer, not a replacement for the user's
intuition.

## Primary success condition

Within the first session, the user should receive a useful reading and
see that it has been saved into a future-looking timeline. Within
several weeks, the app should become more valuable than on day one
because it can show recurring cards, recurring questions, linked life
events, unresolved predictions, and changes across a Journey.

# 2. Product Assumptions for Planning

- **Launch surface:** mobile-first web app/PWA first; native apps can
  follow after product-market validation.

- **Language:** English first, with all taxonomy and prompts designed
  for later localization.

- **Deck systems at launch:** first-class support for both the 78-card Rider-Waite-Smith (RWS) system and Aleister Crowley/Frieda Harris's Thoth Tarot system. The selected deck changes card names, deck-specific symbolism, court-card terminology, correspondences and AI interpretation context; Thoth must never be treated as merely alternate RWS artwork. Users can draw digitally or log their own physical RWS/Thoth deck. Bundled artwork must be public-domain, original, or properly licensed; do not assume the Thoth artwork itself is free to redistribute.

- **Business model:** freemium with a paid tier focused on memory,
  longitudinal analysis and premium AI rather than charging for basic
  storage.

- **Audience:** casual-to-intermediate tarot users who use tarot for
  reflection, guidance and journaling; experienced physical-deck users
  are an important secondary segment.

- **Trust posture:** reflection and entertainment, not deterministic
  fortune-telling or professional medical/legal/financial advice.

- **Privacy posture:** private by default, minimal data collection,
  export/delete controls, and no sale of journal content.

# 3. Research Findings & Competitive Landscape

## 3.1 What competitors already cover

| **Product / category** | **Existing strengths**                                                                                                                                  | **Implication**                                                             |
|------------------------|---------------------------------------------------------------------------------------------------------------------------------------------------------|-----------------------------------------------------------------------------|
| Labyrinthos            | 75+ spreads, digital readings, physical reading logging, journal, card trends, learning, AI interpretations, hindsight reminders, premium subscription. | Do not compete on breadth of tarot content alone.                           |
| Tarot Journal (iOS)    | Custom decks, custom spreads, PDF/HTML export, search by card/keyword/question, long-term personal card meanings.                                       | Search and physical-deck flexibility are table stakes for serious readers.  |
| ArcanaLog / Arcana     | Daily draws, custom spreads, patterns, recurring cards, private/offline positioning, export.                                                            | Recurring-card analytics and privacy are already explicit selling points.   |
| Mindsera               | Ask Your Journal, recurring-topic detection, long-term emotion analysis, story view, AI summaries.                                                      | Generic long-term AI memory is an adjacent-category baseline.               |
| Day One                | Strong journaling UX, prompts, memories, E2EE, AI chat/summaries in paid tier.                                                                          | Users expect journal-grade trust, exportability and polished reflection UX. |

## 3.2 Observed user pain points

Tarot users describe AI readings as generic, overly simplified or
emotionally disconnected. Several users say they value apps for
learning, reference and logging but prefer to perform the actual draw
themselves. <sup>4</sup> <sup>7</sup> <sup>11</sup>

Journaling itself has friction: users report that writing down every
spread becomes a chore, and some fall back to taking photos because
recording enough detail to find patterns later takes too much effort.
<sup>6</sup> <sup>12</sup>

Users also react negatively when accumulated personal history becomes
unexpectedly paywalled. This is particularly damaging for a journal
product because the user's own archive is the source of switching cost
and trust. <sup>5</sup>

Privacy is a visible differentiator in both tarot and AI journaling.
Newer tarot journals advertise no account/no cloud, while AI-journal
users explicitly worry about sending intimate writing to remote models.
<sup>3</sup> <sup>13</sup> <sup>14</sup>

## 3.3 Strategic whitespace

- **Not another card generator.** Digital shuffling is useful for
  accessibility but should not be the product's identity.

- **Not another generic AI interpretation.** The app must ground
  interpretations in the user's exact question, spread position, own
  notes and relevant history.

- **Not merely statistics.** A count of how often The Tower appears is
  interesting but not enough; explain when, around which journeys,
  before/after which events, and whether the user confirmed a
  connection.

- **Own the reading-to-reality loop.** The strongest differentiated
  object is a traceable connection between an old reading and later
  recorded life events/outcomes.

- **Make memory explainable.** Every AI claim about the user's history
  should be traceable to source readings/events; never make the user
  wonder where the app invented something.

- **Respect physical-deck practice.** The app should be a companion for
  physical readers, not insist that a digital draw is equivalent to
  their preferred ritual.

# 4. Product & UX Principles

1.  Capture first, organize automatically. The user should not be forced
    to tag, classify or maintain a database.

2.  Show the useful conclusion before the detail. Every analysis starts
    with a plain-language summary, with evidence beneath it.

3.  Never turn the journal into an analytics dashboard. Prefer narrative
    timelines and a few meaningful visualizations over dense charts.

4.  AI suggestions are proposals, not facts. Inferred events, entity
    matches and correlations carry confidence and can be corrected.

5.  The user's own interpretation remains first-class. AI should not
    overwrite the user's notes or imply that the model is the authority
    on tarot.

6.  Accumulated history should feel safe, portable and owned by the
    user.

7.  Avoid compulsive mechanics. Do not encourage repeated pulls until
    the user gets the answer they want.

8.  Deliver value before asking for payment. The first reading and first
    saved timeline entry should happen before a paywall.

# 5. Information Architecture & Navigation

Recommended primary navigation: Home / Journal / Journey / Ask /
Profile.

| **Area** | **Purpose**                                                                 | **Primary actions**                                                                              |
|----------|-----------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------|
| Home     | Fast start and current context.                                             | Ask question, draw/log cards, resume unresolved reading, see one relevant retrospective insight. |
| Journal  | Chronological archive.                                                      | Browse, search, filter, open/edit reading, log life event, export.                               |
| Journey  | Longitudinal story of an issue.                                             | View timeline, theme shifts, recurring cards, outcomes, evidence-backed AI summary.              |
| Ask      | Natural-language query over personal history.                               | Ask questions, compare periods, surface source readings/events.                                  |
| Profile  | Account, privacy, deck preferences, reminders, subscription, export/delete. | Manage settings without exposing journal content to support by default.                          |

# 6. Core User Experience

## 6.1 First-run onboarding

9.  Welcome: one sentence describing the value — 'See how your readings
    connect over time.'

10. Choose usage style: 'I draw digitally', 'I use my own deck', or
    'Both'. This changes defaults but not feature access.

11. Optional experience level: beginner / comfortable / experienced.
    Used only to tune explanation depth.

12. Short privacy promise and consent for AI processing. Avoid long
    legal copy in onboarding.

13. Immediately start first reading. Do not ask the user to define life
    areas, people, goals or journeys upfront.

The first-session aha moment should occur after the reading is saved:
show 'This reading is now part of your timeline. If something related
happens later, you can connect it—or the app can suggest a possible
link.'

## 6.2 Create a reading

14. Enter or speak a question. Also support 'open reflection' with no
    explicit question.

15. Optionally choose a suggested life area; AI may infer one later.
    Never require it.

16. Choose spread: one-card, three-card, situation/advice/outcome, or
    custom spread.

17. Choose deck system: Rider-Waite-Smith or Thoth. Remember the user's preferred default while allowing per-reading changes.

18. Choose digital draw or physical deck.

19. For digital draw: shuffle animation should be short/skippable;
    random selection must be server/client RNG, not chosen by the LLM.

20. For physical deck: select card names quickly from the chosen deck's native naming. Photo recognition can be a later enhancement. Support reversals where the user chooses to use them.

21. Before AI analysis, allow the user to add 'What I notice' or skip.

22. Present interpretation in layers: one-line synthesis → card-by-card meaning in position → combined interpretation → optional reflective prompts. Interpretations must be deck-aware. For Thoth, use the Thoth system's own terminology and symbolic framework rather than silently substituting RWS meanings.

23. Save automatically. Then offer a lightweight 'Revisit this?'
    timeframe if the reading implies a future outcome.

## 6.3 Reading detail screen

- **At a glance:** question, date, spread, cards, concise overall
  interpretation.

- **Your interpretation:** editable user notes; visually distinct from
  AI output.

- **AI interpretation:** short by default, expandable by
  card/position/theme.

- **Connections:** linked Journey, entities, themes, events and later
  outcomes.

- **Follow-up status:** unresolved / partly resolved / resolved / no
  longer relevant.

- **Evidence history:** all later AI claims should link back to exact
  source items.

- **Controls:** edit, correct metadata, disconnect false correlation,
  export/share a privacy-safe version, delete.

## 6.4 Log a life event

Life events must be fast enough to record outside a reading. A user can
type a sentence such as 'I accepted the new job today.' AI extracts
date, life area, entities and themes, then proposes related
journeys/readings. The user should not have to fill a multi-field form.

- **Quick entry:** one sentence + optional date/photo/note.

- **AI extraction:** event type, entities, topics, emotional tone,
  importance, possible related Journey.

- **Connection review:** show only the strongest 1–3 suggested past
  readings; allow confirm / maybe / unrelated.

- **No forced tarot framing:** a life event may exist without any linked
  reading.

## 6.5 Journey screen — the differentiating experience

A Journey is an evolving real-life subject such as 'Relationship with
Alex', 'Moving to Thailand', 'Career change', or 'Starting my business'.
Journeys are created automatically when evidence is strong or suggested
to the user when ambiguity remains.

| **Section**            | **What the user sees**                                                                          |
|------------------------|-------------------------------------------------------------------------------------------------|
| Narrative header       | One concise sentence: 'Your readings shifted from hesitation to action over the last 3 months.' |
| Timeline               | Interleaved readings and real-life events in chronological order.                               |
| Theme progression      | A small visual or sequence such as uncertainty → conflict → decision → stability.               |
| Recurring symbols      | Cards/suits/themes that recur meaningfully, with context rather than raw counts only.           |
| Open loops             | Past readings with an unresolved timeframe or outcome.                                          |
| Confirmed outcomes     | Connections the user explicitly confirmed.                                                      |
| Possible connections   | AI-suggested links clearly labeled as inferred.                                                 |
| Ask about this Journey | Scoped chat/Q&A grounded only in this Journey's evidence.                                       |

## 6.6 Ask My History

Examples the app should answer well:

- How have my relationship readings changed since June?

- What cards keep appearing when I ask about leaving my job?

- Compare my readings about Bali and Thailand.

- Did any of my old career readings line up with what later happened?

- When did I first start getting themes of independence?

- What questions do I keep asking without resolving?

Every answer must include tappable source references to the
readings/events it used. The system should be allowed to answer 'I don't
have enough evidence' rather than inventing a pattern.


## 6.7 Deck-system behavior

RWS and Thoth support must share the same product workflow while preserving their different interpretive systems. A user should be able to switch decks without losing Journey, entity, event or outcome continuity.

- **Deck identity is first-class.** Every reading stores `deck_id`; every card instance resolves through a deck-specific card definition.
- **Canonical archetype mapping is optional metadata, not interpretation.** The system may map structurally corresponding cards across decks for search/analytics, but must preserve the displayed deck-specific identity and must not flatten Thoth into RWS meanings.
- **Thoth-specific naming must be native.** Examples include Adjustment, Lust, Art, The Aeon and The Universe, plus the Thoth court structure (Knight, Queen, Prince, Princess).
- **Deck-aware meanings.** Reference data and prompts should allow different upright/reversal practices, elemental, astrological, Qabalistic and other deck-specific correspondences where relevant. Users who do not use reversals with Thoth should be able to disable them.
- **Cross-deck history.** A Journey can contain RWS and Thoth readings. Progress analysis may identify a shared higher-level theme, but the UI must always show which deck/card actually appeared.
- **Search aliases.** Search should understand common cross-deck equivalences (for example, RWS Strength versus Thoth Lust) without renaming historical cards.
- **Artwork rights.** The application may support Thoth meanings and card identity without redistributing copyrighted deck scans. If rights to the original artwork are not verified/licensed, use text/card-name UI, legally cleared assets, or commissioned/original visual treatments.

# 7. Domain Model & Persistence Requirements

Use a stable generic model rather than predefining every possible life
subject. AI extracts flexible content into generic objects; the
application owns IDs, validation, versioning and user-level
authorization.

| **Entity**               | **Required fields / notes**                                                                                          |
|--------------------------|----------------------------------------------------------------------------------------------------------------------|
| User                     | id, auth identity, locale, timezone, plan, privacy/AI consent settings.                                              |
| Reading                  | id, user_id, created_at, question, raw notes, spread_id, source=digital\|physical, interpretation, metadata_version. |
| ReadingCard              | reading_id, position, card_id, orientation, user meaning, AI meaning.                                                |
| Spread                   | built-in/custom, named positions, layout metadata.                                                                   |
| Entity                   | stable user-scoped thing: person, organization, place, project, object, etc.; canonical label; status.               |
| EntityAlias              | entity_id, alias text, context, confidence, source.                                                                  |
| Journey                  | user-scoped evolving subject, title, summary, status, date range, confidence.                                        |
| Theme                    | normalized or flexible theme concept with label/category.                                                            |
| LifeEvent                | date/date_range, description, user-confirmed facts, source, importance, metadata_version.                            |
| Prediction / Possibility | reading_id, text, category, expected timeframe, confidence/type; do not imply certainty.                             |
| Outcome                  | reading_id or prediction_id, status, description, event links, user confirmation.                                    |
| Link / Evidence          | typed link between objects, confidence, reasons, source, user_confirmed, created_by=model\|user\|rule.               |
| Embedding                | object_id, object_type, vector, embedding_model/version; deletable with parent object.                               |
| PeriodSummary            | Journey or user period summary with source object IDs and generation/version metadata.                               |

## 7.1 Entity resolution

Raw strings such as 'my girlfriend', 'Alex', 'she', 'my partner' must
never be treated as durable identity. The system resolves them to stable
user-scoped entity IDs. The AI proposes candidate matches; deterministic
application logic decides whether to auto-link, keep tentative, or ask
the user.

- **High confidence:** auto-link if one candidate is clearly dominant
  and context is consistent.

- **Medium confidence:** store as tentative and avoid using it as a
  confirmed fact in summaries.

- **Ambiguous:** ask a lightweight disambiguation question only when the
  distinction affects history.

- **Corrections:** users can merge/split entities; corrections trigger
  re-evaluation of dependent links.

- **Temporal relationships:** roles such as partner/employer may have
  valid_from/valid_to rather than being overwritten.

## 7.2 Flexible AI-extracted metadata

Each reading/event should keep the raw text plus versioned extracted
metadata. Suggested fields include life area, entities, themes, event
mentions, goals, fears, decisions, timeframe, predictions/possibilities,
emotional tone and Journey candidates. Store flexible metadata in JSON
where appropriate so the schema can evolve.

Never discard raw user input after extraction. Future versions must be
able to reprocess historical entries using a newer extraction
schema/model.

# 8. Search, Retrieval & Correlation

## 8.1 Hybrid retrieval

Do not rely on vector search alone. Retrieval should use structured
narrowing, Journey/entity membership, semantic similarity, time
relevance and symbolic overlap.

23. Parse the query into intent, time range, life area, known entities
    and Journey candidates.

24. Retrieve structured candidates by user_id, Journey, entity, date
    range and content type.

25. Rank remaining candidates semantically using embeddings of concise
    retrieval summaries, not only long AI prose.

26. Add relevant life events, outcomes, confirmed links and period
    summaries.

27. Send a bounded evidence package to the LLM.

28. Return an answer with source object IDs so the UI can show exactly
    which readings/events support the claim.

## 8.2 Correlation model

A candidate reading↔event or reading↔reading link should be scored from
multiple signals:

| **Signal**          | **Example**                                         | **Role**                           |
|---------------------|-----------------------------------------------------|------------------------------------|
| Journey overlap     | Both belong to 'Relationship with Alex'.            | Strongest structural signal.       |
| Entity overlap      | Both mention the same person/company/place.         | Strong.                            |
| Semantic similarity | Different wording but same underlying issue.        | Strong.                            |
| Theme overlap       | Commitment, conflict, opportunity.                  | Supporting.                        |
| Timeframe fit       | Event occurred inside the reading's stated horizon. | Important for outcome links.       |
| Card/symbol overlap | Repeated card or suit.                              | Useful but never sufficient alone. |
| Temporal proximity  | Items are close in time.                            | Supporting, decays with distance.  |
| User confirmation   | User said 'Yes, these are related'.                 | Highest-confidence evidence.       |

The exact numeric weights should be tuned empirically. Product behavior
matters more than the initial weights: low-confidence links should
remain invisible or be shown as 'possible'; only user-confirmed links
may be labeled confirmed.

## 8.3 Retrieval documents

Create a compact standardized retrieval representation for every
reading/event. Example: 'Relationship with Alex. Question about
reconciliation after an argument. Themes: hesitation, communication,
repair. Cards: Two of Cups, Five of Wands, Star. Possibility: tension
may settle if communication improves. Timeframe: 1–2 months.' Embed this
concise representation rather than only embedding long generated prose.

# 9. AI System Requirements

## 9.1 AI tasks

- Question/context understanding.

- Structured metadata extraction from readings and life events.

- Entity candidate detection and alias generation.

- Journey candidate creation/assignment.

- Card-in-position interpretation grounded in a controlled tarot
  reference layer.

- Cross-card synthesis and reflective prompts.

- Prediction/possibility and timeframe extraction.

- Historical retrieval query parsing.

- Comparison and progression analysis using retrieved evidence only.

- Event↔reading connection explanation.

- Periodic Journey/weekly/monthly summaries.

- Safety classification for high-stakes or compulsive-use situations.

## 9.2 Fact-status model

| **Status**               | **Meaning**                                      | **Allowed use**                                        |
|--------------------------|--------------------------------------------------|--------------------------------------------------------|
| CONFIRMED_FACT           | Explicitly stated or confirmed by the user.      | May be stated as fact.                                 |
| INFERRED_EVENT           | Model believes an event likely occurred.         | Must be labeled as inferred and not silently promoted. |
| USER_REFLECTION          | User's interpretation, feeling or belief.        | Attribute to the user.                                 |
| TAROT_INTERPRETATION     | Symbolic interpretation of cards.                | Use reflective language; not fact.                     |
| POSSIBILITY / PREDICTION | Potential future outcome suggested in a reading. | Never treat as known future fact.                      |
| SYSTEM_CORRELATION       | Machine-suggested relationship between objects.  | Show confidence/evidence; user can reject.             |

A critical invariant: generated text can never create a CONFIRMED_FACT.
Only user input/confirmation can do so.

## 9.3 Interpretation style

- Specific to the question and spread position; avoid generic 'fortune
  cookie' language.

- Show nuance and multiple plausible readings when symbolism is
  ambiguous.

- Use phrases such as 'suggests', 'may point to', 'one way to read
  this', not deterministic certainty.

- Separate card meaning from synthesis and from practical reflection.

- Offer concise default output with expandable depth.

- Never claim supernatural certainty or fabricated accuracy statistics.

- Allow experienced users to reduce AI explanation and prioritize their
  own interpretation.

## 9.4 Model/provider abstraction

Claude should plan a provider-agnostic AI boundary so prompts,
structured output schemas, model IDs and cost telemetry can change
without rewriting core domain logic. Persist prompt/schema/model
versions on generated artifacts for reproducibility and migration.

# 10. Safety, Trust & Responsible Use

- **High-stakes topics:** If a reading concerns medical, self-harm,
  legal, financial or immediate safety decisions, do not present tarot
  as a substitute for qualified help. Keep the reflection available
  while redirecting consequential decisions to appropriate real-world
  sources.

- **Compulsive repeated readings:** Detect repeated near-identical
  questions in a short window. Instead of endlessly regenerating, show
  the prior reading and offer reflection: 'You've asked this several
  times today; would you like to compare what is driving the
  uncertainty?'

- **No certainty score for the future:** Do not label a reading '87%
  likely' or imply that model confidence is real-world probability.

- **No self-validating loops:** An AI-generated interpretation cannot
  later count as evidence that the event occurred.

- **No forced correlation:** An event may simply be unrelated. The model
  must be allowed to return no connection.

- **Explainability:** Historical claims must link to specific source
  entries.

- **User control:** The user can edit/correct extracted metadata,
  dismiss a connection, merge/split entities, and remove AI summaries.

# 11. Privacy & Security Requirements

Privacy should be a product feature, not only a compliance checkbox.
Offline/private tarot journals now explicitly advertise no account/no
cloud, and leading journals emphasize encryption and consent around AI
processing. <sup>3</sup> <sup>9</sup> <sup>13</sup>

- Use managed authentication; never build password storage manually.

- Every user-owned database row must be protected by server
  authorization and database-level row policies where supported.

- LLM API calls must go through the backend; provider keys never ship to
  the client.

- Send the minimum relevant context to the model, not the user's entire
  history.

- Do not log raw journal content into error/analytics platforms by
  default.

- Private media buckets only; signed/short-lived access URLs.

- Encrypt data in transit and use provider encryption at rest.

- Separate account identity data from journal content logically.

- Provide delete-entry, delete-history, delete-account and export
  functions.

- Deletion must include derived summaries, embeddings, links and
  uploaded media, not only the visible entry.

- Document backup retention and AI-provider processing clearly.

- Admin/support views should not expose journal text by default;
  consider explicit temporary support consent for content access later.

- Avoid third-party ad SDKs and invasive analytics in the journal
  experience.

# 12. Functional Requirements

| **ID** | **Requirement**                                                                                           |
|--------|-----------------------------------------------------------------------------------------------------------|
| FR-01  | User can create an account and sign in securely; optionally support guest/local trial later.              |
| FR-02  | User can create a reading with question/no-question, spread, cards, orientation and notes.                |
| FR-03  | User can choose digital draw or physical-deck entry.                                                      |
| FR-03A | User can choose Rider-Waite-Smith or Thoth per reading, with a remembered default preference. |
| FR-03B | Card selection, display names, reference meanings and AI interpretation must use the selected deck system natively. |
| FR-03C | Cross-deck search may use equivalence aliases, but stored/displayed historical cards must retain their original deck identity. |
| FR-04  | Digital draw randomness is independent of the LLM.                                                        |
| FR-05  | User can use built-in spreads and create custom spreads.                                                  |
| FR-06  | System produces layered AI interpretation and stores version/model metadata.                              |
| FR-07  | Reading is automatically saved and searchable.                                                            |
| FR-08  | System extracts flexible metadata and stores it separately from raw text.                                 |
| FR-09  | System resolves or proposes stable entities and aliases.                                                  |
| FR-10  | System creates/assigns Journey candidates without forcing users to organize manually.                     |
| FR-11  | User can log a free-form life event.                                                                      |
| FR-12  | System proposes related readings/Journeys for a life event with confidence and reasons.                   |
| FR-13  | User can confirm/reject/mark-maybe on correlations.                                                       |
| FR-14  | Future-oriented readings can have an optional revisit date/time horizon.                                  |
| FR-15  | User can mark outcome: happened / partly / did not happen / unresolved / irrelevant, with optional notes. |
| FR-16  | Journey view interleaves readings, events and outcomes chronologically.                                   |
| FR-17  | Journey view shows theme progression and recurring symbols with source evidence.                          |
| FR-18  | Ask My History supports natural-language questions over scoped personal history.                          |
| FR-19  | Every historical AI answer returns source references to exact objects.                                    |
| FR-20  | System can generate weekly/monthly/Journey retrospective summaries after enough data exists.              |
| FR-21  | User can search/filter journal by text, card, date, spread, Journey and entity.                           |
| FR-22  | User can export their data in a machine-readable format; human-readable PDF/Markdown can follow.          |
| FR-23  | User can delete entries/account including derived data.                                                   |
| FR-24  | System supports privacy-safe share cards that exclude private notes by default.                           |
| FR-25  | System detects repeated near-identical questions and can offer reflection instead of infinite redraws.    |
| FR-26  | User can edit AI-extracted metadata and corrections are persisted as user-authoritative.                  |
| FR-27  | User can merge/split entities and re-link affected history.                                               |
| FR-28  | System records analytics events without storing sensitive journal text.                                   |

# 13. Non-Functional Requirements

| **Area**             | **Requirement**                                                                                                                               |
|----------------------|-----------------------------------------------------------------------------------------------------------------------------------------------|
| Performance          | First meaningful screen fast on mobile; AI may stream but should show skeleton/state immediately. Journal browsing must not require AI calls. |
| Reliability          | Readings/events must save transactionally before optional AI post-processing so content is not lost if AI fails.                              |
| Scalability          | Retrieval must remain bounded with thousands of entries per user; use summaries + hybrid retrieval rather than full-history prompts.          |
| Observability        | Track latency, token usage, error class, model version and object IDs; no raw journal content in standard logs.                               |
| Accessibility        | Keyboard navigation, semantic labels, readable contrast, scalable text, reduced-motion support.                                               |
| Internationalization | No hard-coded English taxonomy in business logic; display labels localized separately.                                                        |
| Data portability     | Export stable IDs and relationships where reasonable so users can leave without losing history.                                               |
| Security             | Least privilege, strict authorization, private storage, secret management, dependency updates and rate limits.                                |
| AI resilience        | Structured output validation, retry/fallback policy, refusal/failure states that preserve the saved reading.                                  |
| Cost controls        | Per-user/token budgets, caching for immutable interpretations, summary compression, bounded retrieval context.                                |

# 14. Monetization & Paywall Design

The current market supports paid journaling and tarot subscriptions, but
long-term trust matters. Labyrinthos lists a \$9.99 premium option;
Mindsera lists roughly \$10.75–\$14.99/month; Day One's AI tier is
\$74.99/year. RevenueCat reports \$9.99 as a common monthly anchor and
notes that AI apps monetize strongly but churn faster. <sup>1</sup>
<sup>8</sup> <sup>9</sup> <sup>10</sup>

## Recommended initial packaging

| **Free**                               | **Premium**                                     |
|----------------------------------------|-------------------------------------------------|
| Unlimited basic journal storage        | Advanced AI historical analysis                 |
| Digital + physical card logging        | Ask My History                                  |
| Basic reading interpretation allowance | Higher AI allowance / deeper model              |
| Basic search and recent history        | Journey progression + long-range comparisons    |
| Simple recurring-card stats            | Outcome/correlation analysis                    |
| Manual life-event logging              | Monthly/yearly retrospective reports            |
| Data export/delete                     | Premium customizations / advanced spreads later |

Do not paywall the user's ability to access their own old text after
they have created it. Premium should charge for analysis and
convenience, not ransom accumulated personal history.

Test an annual-first price near the mainstream journaling range plus a
monthly option. Do not optimize pricing before retention is
demonstrated. A 7–14+ day trial is worth testing; RevenueCat's 2026
benchmarks show longer trials converting better than very short trials,
while most trial starts happen immediately.<sup>10</sup>

# 15. Acquisition & Retention Design

## 15.1 Organic acquisition loops

- **Shareable retrospectives:** beautiful, privacy-safe 'My month in
  tarot' cards with recurring card/theme; user chooses exactly what is
  shared.

- **SEO landing pages:** high-quality card/spread reference pages can
  acquire beginners, but should funnel into journaling rather than
  become the whole product.

- **Creator partnerships:** tarot creators demonstrate 'I logged 30 days
  and here is what changed' rather than generic AI readings.

- **Physical-deck angle:** market to users who already own decks: 'Use
  your deck. Let the app remember.'

- **Outcome experiment:** content showing how users revisit old readings
  after 30/90 days can explain the unique value much better than
  screenshots of AI prose.

## 15.2 Retention loops

- Outcome/revisit reminders tied to a specific old reading.

- Weekly reflection after enough activity, not generic spam.

- Journey change detection: 'Your last three readings shifted toward
  action.'

- On-this-day / 30-days-ago resurfacing.

- Unresolved question review instead of encouraging a new repeated pull.

- Monthly retrospective with user-confirmed life events and evidence.

Avoid overusing streaks. Some tarot users explicitly reject gamification
of spiritual practice; habit support should feel optional and reflective
rather than coercive.<sup>15</sup>

# 16. Product Analytics & Success Metrics

| **Stage**          | **Metrics**                                                                                                             |
|--------------------|-------------------------------------------------------------------------------------------------------------------------|
| Activation         | Reading started → completed; first reading saved; time to first interpretation; % choosing physical vs digital.         |
| Early value        | % who open saved reading again; % who create second reading within 7 days; % who create/accept first Journey.           |
| Longitudinal value | % with a confirmed reading↔event link; % with an outcome recorded; Journey views per active user; Ask My History usage. |
| Retention          | D1/D7/D30 active retention; 4-week reading/logging retention; return rate from retrospective reminders.                 |
| AI quality         | thumbs up/down; correction rate; entity merge/split rate; rejected-correlation rate; unsupported-claim reports.         |
| Monetization       | free→trial, trial→paid, first renewal, monthly/annual retention, AI cost per active/paying user.                        |
| Trust              | export usage, delete rate, privacy-page views, support complaints about invented facts or unwanted AI.                  |

# 17. MVP Scope

The MVP should prove one hypothesis: users value tarot more when the app
remembers and connects readings over time.

## MVP must include

- Account/authentication and secure user isolation.

- First-class RWS and Thoth deck-system references, with deck-specific card names, meanings/correspondences and 3–5 core spreads.

- Digital draw plus fast physical-card entry.

- Reading question, cards, reversals, user notes.

- Layered AI interpretation.

- Automatic reading persistence.

- Flexible metadata extraction.

- Basic entity resolution and Journey assignment.

- Free-form life-event logging.

- Reading↔event suggested correlation with confirm/reject.

- Outcome status and optional revisit date.

- Journal timeline.

- Single Journey timeline view.

- Basic recurring-card/theme analysis.

- Ask My History with evidence links.

- Export/delete/privacy controls.

- Minimal subscription/paywall plumbing and usage metering.

## Explicitly defer from MVP

- Marketplace/community/social feed.

- Professional reader marketplace.

- Astrology, numerology, runes, dream interpretation.

- Additional proprietary decks beyond the launch RWS and Thoth systems.

- Full image recognition of arbitrary commercial tarot decks.

- Complex knowledge-graph visualization.

- Voice conversations.

- Therapist/coach features.

- End-to-end encryption if it would block the core retrieval
  architecture; design for future privacy upgrades instead.

- Native iOS/Android apps unless required for distribution testing.

- Heavy gamification, achievements or loot-box-style deck collection.

# 18. Suggested Delivery Phases for Claude to Plan

| **Phase**                     | **Outcome**                                                                                                   |
|-------------------------------|---------------------------------------------------------------------------------------------------------------|
| 0 — Foundations               | Repo, environments, auth, database, RLS/authorization, RWS + Thoth deck/card reference seed data and licensing-safe asset strategy, AI abstraction, observability.    |
| 1 — Reading loop              | Create reading, digital/physical cards, spreads, AI interpretation, save/reopen.                              |
| 2 — Journal + search          | Timeline, filters, reading detail, edit/delete/export basics.                                                 |
| 3 — Structured memory         | Metadata extraction, entities/aliases, Journeys, corrections.                                                 |
| 4 — Life events + outcomes    | Event logging, revisit windows, outcome status, correlation engine.                                           |
| 5 — Longitudinal intelligence | Hybrid retrieval, Ask My History, Journey summaries, recurring themes/cards, evidence citations.              |
| 6 — Monetization + retention  | Usage limits, subscription, reminders, monthly retrospective, share cards.                                    |
| 7 — Hardening/beta            | Security review, privacy flows, migrations, prompt evals, load/cost testing, UX polish, analytics dashboards. |

# 19. Key Acceptance Criteria

- A first-time user can complete and save a reading without creating
  tags/entities/journeys manually.

- A physical-deck user can log a 3-card reading in under roughly one
  minute excluding their own reflection.

- A Thoth reading displays and interprets Thoth-native card names/meanings (including court-card and Major Arcana differences) and never silently substitutes RWS terminology.

- A Journey may contain readings from both RWS and Thoth while preserving the original deck/card identity of every historical reading.

- Opening an old reading never requires an AI call.

- If AI is unavailable, the user's reading is still saved and usable.

- The system can distinguish confirmed facts from inferred events and
  tarot interpretations in persistence and prompts.

- An AI historical answer can always return the source IDs used, or
  state that evidence is insufficient.

- Deleting a reading removes or invalidates its derived
  embeddings/summaries/links.

- Entity aliases can resolve different references to one stable entity
  without overwriting historical relationship roles.

- A rejected correlation is not repeatedly re-suggested without
  materially new evidence.

- Journey summaries never cite a model-generated summary as the sole
  evidence for a real-life event.

- Users can access their own saved text regardless of subscription
  status.

- No raw journal content appears in standard logs/analytics events.

# 20. Instructions for the Implementation Planner

When this specification is given to Claude, ask it to produce a concrete
implementation plan rather than immediately coding. The plan should
preserve the product invariants above and decompose work into
independently testable sessions.

- Propose the exact tech stack and justify trade-offs, but keep the
  domain model provider-agnostic.

- Provide database schema/migrations, RLS/authorization strategy, API
  boundaries and object lifecycle.

- Define structured AI schemas/prompts and versioning strategy.

- Define entity-resolution and Journey-assignment algorithms with
  thresholds and correction flows.

- Define hybrid retrieval, embedding strategy, summary compaction and
  source-evidence propagation.

- Define correlation scoring and how user feedback changes confidence.

- Define failure handling for AI timeouts/invalid JSON/provider outage.

- Define privacy/deletion/export implementation including derived data.

- Define automated tests: unit, integration, authorization/RLS,
  prompt/eval tests and end-to-end flows.

- Define seed/demo data so the longitudinal UI can be tested without
  waiting months.

- Define feature flags so risky AI memory/correlation behavior can be
  rolled out gradually.

- Define cost telemetry and model-routing rules.

- Break implementation into phases that fit separate coding sessions,
  each ending in a runnable, testable state.

# 21. Product Decisions That Must Not Be Lost During Implementation

- The app is a longitudinal journal first, AI tarot reader second.

- Both physical and digital drawing are first-class.

- RWS and Thoth are first-class launch deck systems; deck identity is persisted and interpretation is deck-aware.

- Raw user text is preserved; AI metadata is derived and versioned.

- Entities have stable IDs; aliases are not identities.

- Journeys are evolving subjects, not just tags.

- Confirmed facts, inferred events, tarot interpretations and
  predictions are distinct data types/statuses.

- Correlation is evidence-based and reversible.

- Every historical AI claim is source-grounded.

- The user never has to manually maintain the underlying knowledge
  graph.

- The archive remains accessible even if the user stops paying.

- Privacy and trust are part of the product proposition.

- The app should not encourage compulsive repeated readings.

# 22. Validation Plan Before Full Build-Out

Build only enough of the polished flow to test whether users care about
the differentiated loop. Recruit 10–20 tarot users across beginners and
physical-deck readers. Give them a seeded demo plus their own account
for 2–4 weeks.

- Can they log physical readings without frustration?

- Do they understand Journey without explanation?

- Do they trust or reject suggested correlations?

- Which evidence display makes AI conclusions feel credible?

- Do revisit/outcome prompts feel useful or annoying?

- Do they voluntarily open Progress/Journey views after several
  readings?

- Would they pay specifically for historical analysis, rather than
  generic AI interpretation?

- Do experienced readers feel that AI supports rather than replaces
  their own interpretation?

The go/no-go signal is not simply whether users enjoy an AI reading. It
is whether accumulated history creates increasing value and makes them
return to review old readings.

# Sources

1\. Labyrinthos Tarot Cards — Google Play / App Store information and
premium features.
https://play.google.com/store/apps/details?id=com.labyrinthos.app ;
https://labyrinthos.co/pages/app

2\. Tarot Journal — Apple App Store listing (custom decks/spreads,
search, export).
https://apps.apple.com/us/app/tarot-journal/id1271120458

3\. ArcanaLog / Arcana — App Store and Google Play listings (patterns,
privacy, offline journal).
https://apps.apple.com/us/app/arcanalog-tarot-journal/id6788596342 ;
https://play.google.com/store/apps/details?id=com.arcana.journal

4\. Reddit r/tarot — 'What are your thoughts on the app Labyrinthos?'
User feedback on learning, logging, UI and generic AI.
https://www.reddit.com/r/tarot/comments/17t3eop/what_are_your_thoughts_on_the_app_labyrinthos/

5\. Reddit r/tarot — Labyrinthos paywall discussion, July 2024.
https://www.reddit.com/r/tarot/comments/1dw58np/labyrinthos_just_implemented_another_paywallwhere/

6\. Reddit r/tarot — 'Do you journal every time you do a reading?' User
friction around recording readings.
https://www.reddit.com/r/tarot/comments/1gyncv5/do_you_journal_every_time_you_do_a_reading/

7\. Reddit r/tarot — 'AI Doesn't Belong In Tarot!' Discussion showing
resistance to AI-generated readings and preference for interpretation
aid.
https://www.reddit.com/r/tarot/comments/1hhlgne/ai_doesnt_belong_in_tarot/

8\. Mindsera — official feature and pricing pages: Ask Your Journal,
recurring topics, long-term emotion analysis, story view.
https://mindsera.com/ ;
https://help.mindsera.com/comparison/free-plan-vs-paid-plan

9\. Day One — official plans and AI/privacy documentation, 2026.
https://dayoneapp.com/plans/ ;
https://dayoneapp.com/guides/ai-features/ai-features/

10\. RevenueCat — State of Subscription Apps 2026.
https://www.revenuecat.com/state-of-subscription-apps

11\. Reddit r/Tarotpractices — 'Beware of AI Tarot Readers', May 2026;
complaints about vague/generic AI readings.
https://www.reddit.com/r/Tarotpractices/comments/1ta12iu/beware_of_ai_tarot_readers/

12\. Reddit r/tarot — physical reading logging and trend-search pain
points.
https://www.reddit.com/r/tarot/comments/z6nmuw/looking_for_an_app_to_log_physical_tarot_readings/

13\. Reddit r/iosapps — Pip Tarot Journal launch: offline/no account/no
AI privacy positioning, July 2026.
https://www.reddit.com/r/iosapps/comments/1v4sb3q/built_my_girlfriend_a_tarot_journal_app_and/

14\. Reddit discussions of on-device AI journaling and privacy concerns,
2026.
https://www.reddit.com/r/iOSDevelopment/comments/1tuqby5/i_built_an_ai_journaling_app_where_the_ai_runs_on/

15\. Reddit r/TarotDecks — developer discussion emphasizing no data
collection and avoiding gamification.
https://www.reddit.com/r/TarotDecks/comments/16f4uij/i_made_a_tarot_app_where_you_can_put_together/

Research note: App-store listings and Reddit discussions are used for
product/UX evidence, not as proof of objective tarot efficacy.
Qualitative community feedback is directional and may not represent all
tarot users.
