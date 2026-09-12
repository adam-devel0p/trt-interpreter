import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import sharp, { type Sharp } from 'sharp';
import { RWS_DECK } from '../src/db/seed/decks/rws';

/**
 * RWS artwork pipeline (docs/LICENSING.md). Downloads the public-domain 1909 Pamela Colman
 * Smith scans from Wikimedia Commons into a gitignored cache, then encodes each card to AVIF
 * and WebP at 160 / 320 / 640 px wide under public/cards/rws/<slug>-<w>.<ext>. Skips outputs
 * that already exist, so it is cheap to re-run; pass --force to re-encode.
 *
 *   pnpm art:build            # everything missing
 *   pnpm art:build --force    # re-encode all
 */
const CACHE = path.resolve('.cache/card-art/rws');
const OUT = path.resolve('public/cards/rws');
const WIDTHS = [160, 320, 640] as const;
const UA = 'TarotJournal/0.1 (card-art build script; contact via repository)';
const force = process.argv.includes('--force');

/** Wikimedia Commons file names for the 1909 deck ("RWS_Tarot_NN_Name.jpg", "Cups01.jpg" …). */
function commonsFile(slug: string): string {
  const card = RWS_DECK.cards.find((c) => c.slug === slug)!;
  if (card.arcana === 'major') {
    const nn = String(card.number).padStart(2, '0');
    const name = card.name.replace(/^The /, '').replace(/\s+/g, '_');
    return `RWS_Tarot_${nn}_${name}.jpg`;
  }
  const suit = (
    { wands: 'Wands', cups: 'Cups', swords: 'Swords', pentacles: 'Pents' } as Record<string, string>
  )[card.suit!]!;
  const rank = card.number ?? { Page: 11, Knight: 12, Queen: 13, King: 14 }[card.rank_label!]!;
  return `${suit}${String(rank).padStart(2, '0')}.jpg`;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Polite fetch: one request at a time, a pause between files, back off on 429. */
async function download(file: string, dest: string) {
  if (existsSync(dest)) return;
  const url = `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(file)}`;
  for (let attempt = 0; attempt < 6; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
    if (res.status === 429) {
      await sleep(5_000 * (attempt + 1));
      continue;
    }
    if (!res.ok) throw new Error(`${file}: HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 20_000) throw new Error(`${file}: suspiciously small (${buf.length} bytes)`);
    writeFileSync(dest, buf);
    await sleep(750);
    return;
  }
  throw new Error(`${file}: rate limited repeatedly`);
}

async function encode(src: string, slug: string) {
  const input = readFileSync(src);
  for (const w of WIDTHS) {
    const base = path.join(OUT, `${slug}-${w}`);
    const targets: [string, () => Sharp][] = [
      [`${base}.avif`, () => sharp(input).resize({ width: w }).avif({ quality: 55, effort: 6 })],
      [`${base}.webp`, () => sharp(input).resize({ width: w }).webp({ quality: 78, effort: 5 })],
    ];
    for (const [file, make] of targets) {
      if (!force && existsSync(file)) continue;
      await make().toFile(file);
    }
  }
}

async function main() {
  mkdirSync(CACHE, { recursive: true });
  mkdirSync(OUT, { recursive: true });
  let done = 0;
  for (const card of RWS_DECK.cards) {
    const file = commonsFile(card.slug);
    const cached = path.join(CACHE, `${card.slug}.jpg`);
    await download(file, cached);
    await encode(cached, card.slug);
    done += 1;
    if (done % 13 === 0) console.log(`  ${done}/78`);
  }
  console.log(
    `card art ready: ${done} cards × ${WIDTHS.length} widths × 2 formats in public/cards/rws`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
