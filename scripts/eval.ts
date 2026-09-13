import './_env';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { getAiRunner } from '../src/ai';
import { buildSafetyRequest } from '../src/ai/tasks/classify_safety';
import {
  allText,
  buildInterpretRequest,
  resolveCardIds,
  type InterpretReadingInput,
} from '../src/ai/tasks/interpret_reading';
import * as interpretVersion from '../src/ai/tasks/interpret_reading/version';
import { buildExtractRequest } from '../src/ai/tasks/extract_reading_metadata';
import type { ExtractionPayload } from '../src/domain/extraction/schema';
import * as extractVersion from '../src/ai/tasks/extract_reading_metadata/version';
import { normalizeAlias } from '../src/domain/entities/normalize';
import { resolveThemeLabel } from '../src/domain/themes/taxonomy';
import { closeAdmin } from '../src/db/admin';
import { RWS_DECK } from '../src/db/seed/decks/rws';
import { THOTH_DECK } from '../src/db/seed/decks/thoth';
import { SPREADS } from '../src/db/seed/decks/spreads';
import { findPurityViolations } from '../src/domain/decks/purity';
import {
  selectDepth,
  type ExperienceLevel,
  type ExplanationDepth,
} from '../src/domain/interpretation/depth';
import { findRegisterViolations, hedgeCount } from '../src/domain/interpretation/register';
import {
  NO_FLAG,
  type SafetyCategory,
  type SafetyClassification,
} from '../src/domain/safety/categories';
import { bannedTermsFor, forbiddenTermsSample } from '../src/interpretation/vocabulary';

/**
 * Prompt eval runner (docs/AI_LAYER.md#eval-suite). Never runs in CI — with the real provider it
 * costs money. Fixtures: src/ai/tasks/<task>/fixtures/*.json. Checks per interpretation:
 * schema validity (the runner enforces it), deck purity, hedged register, positional
 * specificity, acknowledgement of the user's note, hedge density; per safety case: category.
 * Outputs land in fixtures/__baselines__/<name>.json for a human to read — the text quality
 * judgement (specific vs fortune-cookie, §3.3) is theirs, not the script's.
 *
 *   pnpm eval               # AI_PROVIDER from env (anthropic needs ANTHROPIC_API_KEY)
 *   pnpm eval --dry         # mock provider: proves the pipeline, costs nothing
 */

interface InterpretFixture {
  name: string;
  description: string;
  deck: 'rws' | 'thoth';
  spread: string;
  question: string | null;
  life_area: string | null;
  cards: { slug: string; orientation: 'upright' | 'reversed' }[];
  user_notes: string | null;
  depth: ExplanationDepth;
  experience_level: ExperienceLevel;
  expect: { acknowledges_note: boolean; safety_category?: SafetyCategory };
}

interface ExtractFixture {
  name: string;
  description: string;
  question: string | null;
  life_area: string | null;
  user_notes: string | null;
  deck: 'rws' | 'thoth';
  spread: string;
  cards: { slug: string; orientation: 'upright' | 'reversed' }[];
  expect: {
    life_area: string | null;
    entities: { mention: string; kind: string }[];
    forbidden_mentions: string[];
    themes_any: string[];
    themes_max?: number;
    possibilities_max: number;
    timeframe: boolean;
  };
}

interface SafetyFixture {
  name: string;
  cases: { question: string; category: SafetyCategory }[];
}

const TASKS_DIR = path.resolve('src/ai/tasks');
const CARD_ID = (i: number) =>
  `00000000-0000-4000-8000-0000000000${(10 + i).toString(16).padStart(2, '0')}`;

function loadFixtures<T>(task: string): T[] {
  const dir = path.join(TASKS_DIR, task, 'fixtures');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json') && !f.startsWith('__'))
    .map((f) => JSON.parse(readFileSync(path.join(dir, f), 'utf8')) as T);
}

function toInput(fx: InterpretFixture, safety: SafetyClassification): InterpretReadingInput {
  const deck = fx.deck === 'rws' ? RWS_DECK : THOTH_DECK;
  const spread = SPREADS.find((s) => s.slug === fx.spread);
  if (!spread) throw new Error(`fixture ${fx.name}: unknown spread ${fx.spread}`);
  if (spread.positions.length !== fx.cards.length) {
    throw new Error(
      `fixture ${fx.name}: ${fx.cards.length} cards for a ${spread.positions.length}-card spread`,
    );
  }
  return {
    question: fx.question,
    is_open_reflection: fx.question === null,
    life_area: fx.life_area,
    deck: {
      name: deck.name,
      system: deck.system,
      tradition_notes: deck.tradition_notes,
      supports_reversals: deck.supports_reversals,
    },
    spread: { name: spread.name, description: spread.description },
    cards: fx.cards.map((c, i) => {
      const card = deck.cards.find((x) => x.slug === c.slug);
      if (!card) throw new Error(`fixture ${fx.name}: unknown card ${c.slug} in ${deck.slug}`);
      const reversed = c.orientation === 'reversed' && deck.supports_reversals;
      const hasReversed = reversed && !!card.meaning_reversed;
      const pos = spread.positions[i]!;
      return {
        position_index: i,
        position_name: pos.name,
        position_prompt: pos.prompt,
        card_id: CARD_ID(i),
        name: card.name,
        title: card.title,
        arcana: card.arcana,
        suit_label: card.suit_label,
        rank_label: card.rank_label,
        numeral: card.numeral,
        number: card.number,
        element: card.element,
        astrology: card.astrology,
        correspondences: card.correspondences,
        orientation: reversed ? 'reversed' : 'upright',
        keywords:
          hasReversed && card.keywords_reversed.length
            ? card.keywords_reversed
            : card.keywords_upright,
        meaning: hasReversed ? card.meaning_reversed! : card.meaning_upright,
        reversed_without_text: reversed && !hasReversed,
      };
    }),
    user_notes: fx.user_notes,
    depth: selectDepth({ ai_explanation_depth: fx.depth, experience_level: fx.experience_level }),
    safety,
    forbidden_terms_sample: forbiddenTermsSample(deck.system),
  };
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** Any three consecutive words of the note appear in the output, or the output refers to it. */
function acknowledgesNote(note: string, output: string): boolean {
  const o = norm(output);
  if (/\b(you (noticed|wrote|said|mentioned)|your (note|own words|reading|sense))\b/.test(o))
    return true;
  const words = norm(note).split(' ');
  for (let i = 0; i + 3 <= words.length; i++) {
    if (o.includes(words.slice(i, i + 3).join(' '))) return true;
  }
  return false;
}

async function main() {
  const { values } = parseArgs({ options: { dry: { type: 'boolean', default: false } } });
  if (values.dry) process.env.AI_PROVIDER = 'mock';
  const provider = process.env.AI_PROVIDER ?? 'mock';
  if (provider === 'anthropic' && !process.env.ANTHROPIC_API_KEY) {
    console.error(
      'AI_PROVIDER=anthropic but ANTHROPIC_API_KEY is empty. Set it, or run `pnpm eval --dry`.',
    );
    process.exitCode = 1;
    return;
  }
  const runner = getAiRunner();
  const baselineDir = path.join(TASKS_DIR, 'interpret_reading/fixtures/__baselines__');
  mkdirSync(baselineDir, { recursive: true });
  console.log(
    `eval · provider ${provider} · ${interpretVersion.PROMPT_VERSION} · ${interpretVersion.SCHEMA_VERSION}`,
  );

  let hardFailures = 0;
  const summary: string[] = [];

  // ── classify_safety ────────────────────────────────────────────────────────────────────
  for (const fx of loadFixtures<SafetyFixture>('classify_safety')) {
    let ok = 0;
    const results = [];
    for (const c of fx.cases) {
      const r = await runner.runObject({
        ...buildSafetyRequest(c.question, { userId: '', readingId: 'eval' }),
        userId: undefined,
      });
      const got = r.ok ? r.value : null;
      const pass = got?.category === c.category;
      if (pass) ok++;
      else hardFailures++;
      results.push({ question: c.question, expected: c.category, got, pass });
      console.log(
        `  safety ${pass ? '✓' : '✗'} ${c.category.padEnd(17)} ← ${got?.category ?? (r.ok ? '' : r.status)}/${got?.severity ?? ''}  "${c.question.slice(0, 60)}"`,
      );
    }
    summary.push(`classify_safety: ${ok}/${fx.cases.length} categories correct`);
    const dir = path.join(TASKS_DIR, 'classify_safety/fixtures/__baselines__');
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, `${fx.name}.json`),
      JSON.stringify({ provider, ran_at: new Date().toISOString(), results }, null, 2),
    );
  }

  // ── extract_reading_metadata (Phase 06) ────────────────────────────────────────────────
  // Entity recall/precision over normalised mentions (+ kind), pronouns never proposed, at
  // least one expected theme and every theme on the taxonomy or short, no probabilities.
  const extractDir = path.join(TASKS_DIR, 'extract_reading_metadata/fixtures/__baselines__');
  mkdirSync(extractDir, { recursive: true });
  const extractTotals = { expected: 0, got: 0, hit: 0 };
  for (const fx of loadFixtures<ExtractFixture>('extract_reading_metadata')) {
    const deck = fx.deck === 'rws' ? RWS_DECK : THOTH_DECK;
    const spread = SPREADS.find((s) => s.slug === fx.spread)!;
    const req = buildExtractRequest(
      {
        question: fx.question,
        is_open_reflection: fx.question === null,
        user_notes: fx.user_notes,
        life_area: fx.life_area,
        occurred_on: '2026-06-01',
        deck_name: deck.name,
        spread_name: spread.name,
        cards: fx.cards.map((c, i) => ({
          position_name: spread.positions[i]?.name ?? `Position ${i + 1}`,
          card_name: deck.cards.find((x) => x.slug === c.slug)?.name ?? c.slug,
          orientation: c.orientation,
        })),
      },
      { userId: 'eval', readingId: fx.name },
    );
    const started = Date.now();
    const r = await runner.runObject({ ...req, userId: undefined });
    const checks: Record<string, { pass: boolean; detail?: unknown }> = {};
    let value: ExtractionPayload | null = null;
    if (r.ok) {
      value = r.value;
      const got = new Map<string, string>(
        value.entities.map((e) => [normalizeAlias(e.mention), e.kind]),
      );
      const expected = new Map<string, string>(
        fx.expect.entities.map((e) => [normalizeAlias(e.mention), e.kind]),
      );
      const hits = [...expected].filter(([m, k]) => got.get(m) === k);
      const recall = expected.size ? hits.length / expected.size : 1;
      const precision = got.size
        ? [...got].filter(([m, k]) => expected.get(m) === k).length / got.size
        : 1;
      extractTotals.expected += expected.size;
      extractTotals.got += got.size;
      extractTotals.hit += hits.length;
      checks.schema = { pass: true };
      checks.entity_recall = {
        pass: recall >= 0.99,
        detail: { recall, missing: [...expected.keys()].filter((m) => !got.has(m)) },
      };
      checks.entity_precision = {
        pass: precision >= 0.5,
        detail: { precision, extra: [...got.keys()].filter((m) => !expected.has(m)) },
      };
      const forbidden = fx.expect.forbidden_mentions.map(normalizeAlias).filter((m) => got.has(m));
      checks.no_pronouns = { pass: forbidden.length === 0, detail: forbidden };
      const themeSlugs = value.themes.map((t) => resolveThemeLabel(t.label)?.slug ?? `~${t.label}`);
      checks.theme_sanity = {
        pass:
          (fx.expect.themes_any.length === 0 ||
            themeSlugs.some((t) => fx.expect.themes_any.includes(t))) &&
          value.themes.length <= (fx.expect.themes_max ?? 5) &&
          value.themes.every((t) => t.label.length <= 40),
        detail: themeSlugs,
      };
      checks.life_area = { pass: value.life_area === fx.expect.life_area, detail: value.life_area };
      checks.possibilities = {
        pass:
          value.possibilities.length <= fx.expect.possibilities_max &&
          !/\b(will|definitely|certainly|\d+%)\b/i.test(
            value.possibilities.map((p) => p.text).join(' '),
          ),
        detail: value.possibilities.map((p) => p.text),
      };
      checks.timeframe = {
        pass: !!value.timeframe === fx.expect.timeframe,
        detail: value.timeframe,
      };
      checks.no_probability = { pass: !/probab/i.test(JSON.stringify(value)) };
    } else {
      checks.schema = { pass: false, detail: { status: r.status, errorClass: r.errorClass } };
    }
    const failed = Object.entries(checks)
      .filter(([, c]) => !c.pass)
      .map(([k]) => k);
    hardFailures += failed.length;
    const line = `  extract   ${failed.length === 0 ? '✓' : '✗'} ${fx.name.padEnd(32)} ${r.ok ? `entities=${r.value.entities.length} themes=${r.value.themes.length}` : `${r.status}/${r.errorClass}`} ${(Date.now() - started) / 1000}s${failed.length ? `  FAILED: ${failed.join(', ')}` : ''}`;
    console.log(line);
    summary.push(line.trim());
    writeFileSync(
      path.join(extractDir, `${fx.name}.json`),
      JSON.stringify(
        {
          fixture: fx.name,
          description: fx.description,
          provider,
          model: r.ok ? r.meta.modelId : null,
          prompt_version: extractVersion.PROMPT_VERSION,
          schema_version: extractVersion.SCHEMA_VERSION,
          ran_at: new Date().toISOString(),
          checks,
          output: value,
          human_review: { reviewed_by: null, reviewed_at: null, verdict: null, notes: null },
        },
        null,
        2,
      ),
    );
  }
  if (extractTotals.expected > 0) {
    const recall = extractTotals.hit / extractTotals.expected;
    const precision = extractTotals.got ? extractTotals.hit / extractTotals.got : 1;
    summary.push(
      `extract_reading_metadata: entity recall ${(recall * 100).toFixed(0)}% · precision ${(precision * 100).toFixed(0)}% over ${extractTotals.expected} expected mentions`,
    );
  }

  // ── interpret_reading ──────────────────────────────────────────────────────────────────
  for (const fx of loadFixtures<InterpretFixture>('interpret_reading')) {
    const started = Date.now();
    let safety: SafetyClassification = NO_FLAG;
    if (fx.question) {
      const s = await runner.runObject({
        ...buildSafetyRequest(fx.question, { userId: '', readingId: fx.name }),
        userId: undefined,
      });
      if (s.ok) safety = s.value;
    }
    const input = toInput(fx, safety);
    const banned = bannedTermsFor(input.deck.system);
    const req = buildInterpretRequest(input, {
      userId: 'eval',
      readingId: fx.name,
      bannedTerms: banned,
    });
    let streamedChars = 0;
    let resets = 0;
    let terminal:
      | { type: 'done'; attempts: number; meta: Record<string, unknown> }
      | { type: 'failed'; status: string; errorClass: string; attempts: number; issues?: string[] }
      | null = null;
    let value: ReturnType<typeof resolveCardIds> | null = null;
    for await (const e of runner.runStreamObject(req)) {
      if (e.type === 'text') streamedChars += e.text.length;
      else if (e.type === 'reset') {
        resets++;
        streamedChars = 0;
      } else if (e.type === 'done') {
        value = resolveCardIds(e.value, input);
        terminal = {
          type: 'done',
          attempts: e.attempts,
          meta: e.meta as unknown as Record<string, unknown>,
        };
      } else if (e.type === 'failed') {
        terminal = {
          type: 'failed',
          status: e.status,
          errorClass: e.errorClass,
          attempts: e.attempts,
          issues: e.issues,
        };
      }
    }

    const checks: Record<string, { pass: boolean; detail?: unknown }> = {};
    if (value) {
      const out = allText(value);
      const purity = findPurityViolations(out, banned);
      const register = findRegisterViolations(out);
      const positional = value.per_card.map((c) => {
        const card = input.cards[c.position_index]!;
        const t = c.text.toLowerCase();
        return {
          position: card.position_name,
          card: card.name,
          mentions_position: t.includes(card.position_name.toLowerCase()) || /\bposition\b/.test(t),
          mentions_card:
            t.includes(card.name.toLowerCase()) ||
            (card.title ? t.includes(card.title.toLowerCase()) : false),
        };
      });
      const positionalOk = positional.every((p) => p.mentions_position || p.mentions_card);
      const ack = fx.user_notes ? acknowledgesNote(fx.user_notes, out) : null;
      checks.schema = { pass: true };
      checks.deck_purity = { pass: purity.length === 0, detail: purity };
      checks.register = { pass: register.length === 0, detail: register };
      checks.positional = { pass: positionalOk, detail: positional };
      checks.note_acknowledged = {
        pass: ack === null ? true : ack === fx.expect.acknowledges_note,
        detail: ack,
      };
      checks.hedge_density = {
        pass: hedgeCount(out) >= value.per_card.length,
        detail: hedgeCount(out),
      };
      checks.prompts = {
        pass: value.reflective_prompts.every((p) => p.trim().endsWith('?')),
        detail: value.reflective_prompts,
      };
      if (fx.expect.safety_category) {
        checks.safety = { pass: safety.category === fx.expect.safety_category, detail: safety };
      }
    } else {
      checks.schema = { pass: false, detail: terminal };
    }
    const failed = Object.entries(checks)
      .filter(([, c]) => !c.pass)
      .map(([k]) => k);
    hardFailures += failed.length;
    const line = `  interpret ${failed.length === 0 ? '✓' : '✗'} ${fx.name.padEnd(32)} attempts=${terminal?.attempts ?? '?'} resets=${resets} ${terminal?.type === 'done' ? `tokens=${terminal.meta.tokensIn}/${terminal.meta.tokensOut} cost=$${(Number(terminal.meta.costMicros) / 1e6).toFixed(4)} ` : `${terminal?.status}/${terminal?.errorClass} `}${(Date.now() - started) / 1000}s${failed.length ? `  FAILED: ${failed.join(', ')}` : ''}`;
    console.log(line);
    summary.push(line.trim());
    writeFileSync(
      path.join(baselineDir, `${fx.name}.json`),
      JSON.stringify(
        {
          fixture: fx.name,
          description: fx.description,
          provider,
          model: terminal?.type === 'done' ? terminal.meta.modelId : null,
          prompt_version: interpretVersion.PROMPT_VERSION,
          schema_version: interpretVersion.SCHEMA_VERSION,
          ran_at: new Date().toISOString(),
          safety,
          depth: input.depth.depth,
          checks,
          terminal,
          streamed_chars: streamedChars,
          output: value,
          human_review: { reviewed_by: null, reviewed_at: null, verdict: null, notes: null },
        },
        null,
        2,
      ),
    );
  }

  console.log('\n' + summary.join('\n'));
  console.log(
    hardFailures === 0
      ? '\neval: all mechanical checks passed — now read the baselines.'
      : `\neval: ${hardFailures} check(s) failed`,
  );
  if (hardFailures > 0) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? `${err.name}: ${err.message}` : err);
    process.exitCode = 1;
  })
  .finally(() => closeAdmin());
