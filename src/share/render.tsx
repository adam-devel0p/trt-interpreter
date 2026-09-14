import 'server-only';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { CSSProperties } from 'react';
import type { ShareCardPayload } from '@/domain/share/payload';
import { SHARE_PALETTE as P } from '@/ui/theme-colors';

/**
 * The share card image (FR-24, §15.1). 1080 × 1350 (4:5), drawn from a `ShareCardPayload`
 * and nothing else: every string on the image is a field of the payload the tests inspect.
 * Paper-and-ink in the dark palette; the accent is the deck's, as everywhere in the app.
 * RWS cards show their bundled art; Thoth cards get the typographic face (invariant 3).
 */
export const CARD_W = 1080;
export const CARD_H = 1350;

const SERIF = 'Newsreader';
const SANS = 'DM Sans';

let fontCache: Promise<
  { name: string; data: ArrayBuffer; weight: 400 | 500; style: 'normal' | 'italic' }[]
> | null = null;

export function shareFonts() {
  fontCache ??= (async () => {
    const root = path.join(process.cwd(), 'node_modules', '@fontsource');
    const load = async (rel: string) => {
      const buf = await readFile(path.join(root, rel));
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
    };
    return [
      {
        name: SERIF,
        data: await load('newsreader/files/newsreader-latin-400-normal.woff'),
        weight: 400 as const,
        style: 'normal' as const,
      },
      {
        name: SERIF,
        data: await load('newsreader/files/newsreader-latin-400-italic.woff'),
        weight: 400 as const,
        style: 'italic' as const,
      },
      {
        name: SERIF,
        data: await load('newsreader/files/newsreader-latin-500-normal.woff'),
        weight: 500 as const,
        style: 'normal' as const,
      },
      {
        name: SANS,
        data: await load('dm-sans/files/dm-sans-latin-400-normal.woff'),
        weight: 400 as const,
        style: 'normal' as const,
      },
      {
        name: SANS,
        data: await load('dm-sans/files/dm-sans-latin-500-normal.woff'),
        weight: 500 as const,
        style: 'normal' as const,
      },
    ];
  })();
  return fontCache;
}

const accentFor = (system: 'rws' | 'thoth' | 'mixed') =>
  system === 'rws' ? P.accentRws : system === 'thoth' ? P.accentThoth : P.accentMixed;

const row: CSSProperties = { display: 'flex', flexDirection: 'row' };
const col: CSSProperties = { display: 'flex', flexDirection: 'column' };

function Frame({
  accent,
  eyebrow,
  children,
  footer,
}: {
  accent: string;
  eyebrow: string;
  children: React.ReactNode;
  footer: string;
}) {
  return (
    <div
      style={{
        ...col,
        width: CARD_W,
        height: CARD_H,
        background: P.bg,
        color: P.fg,
        fontFamily: SANS,
        padding: 72,
        justifyContent: 'space-between',
      }}
    >
      <div style={{ ...row, alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ ...row, alignItems: 'center', gap: 16 }}>
          <div style={{ width: 14, height: 14, borderRadius: 999, background: accent }} />
          <span
            style={{ fontSize: 26, letterSpacing: 4, textTransform: 'uppercase', color: P.fgMuted }}
          >
            {eyebrow}
          </span>
        </div>
        <span style={{ fontFamily: SERIF, fontSize: 30, color: P.fgMuted }}>Tarot Journal</span>
      </div>
      <div
        style={{
          ...col,
          flexGrow: 1,
          justifyContent: 'center',
          gap: 36,
          paddingTop: 36,
          paddingBottom: 36,
        }}
      >
        {children}
      </div>
      <div
        style={{
          ...row,
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          borderTop: `2px solid ${P.hairline}`,
          paddingTop: 28,
        }}
      >
        <span style={{ fontSize: 26, color: P.fgMuted }}>{footer}</span>
        <span style={{ fontSize: 24, color: P.fgMuted, fontStyle: 'italic', fontFamily: SERIF }}>
          Reflection, not prediction.
        </span>
      </div>
    </div>
  );
}

function Chip({ text, accent }: { text: string; accent: string }) {
  return (
    <span
      style={{
        fontSize: 26,
        color: P.fg,
        border: `2px solid ${P.hairlineStrong}`,
        borderRadius: 999,
        padding: '10px 22px',
        display: 'flex',
      }}
    >
      <span style={{ color: accent, marginRight: 10 }}>·</span>
      {text}
    </span>
  );
}

function TypographicFace({
  name,
  caption,
  accent,
  reversed,
}: {
  name: string;
  caption: string | null;
  accent: string;
  reversed: boolean;
}) {
  return (
    <div
      style={{
        ...col,
        width: 200,
        height: 340,
        border: `3px solid ${accent}`,
        borderRadius: 14,
        background: P.surface,
        alignItems: 'center',
        justifyContent: 'center',
        padding: 18,
        ...(reversed ? { transform: 'rotate(180deg)' } : {}),
      }}
    >
      <div
        style={{
          ...col,
          flexGrow: 1,
          width: '100%',
          border: `1px solid ${P.hairlineStrong}`,
          borderRadius: 8,
          alignItems: 'center',
          justifyContent: 'center',
          padding: 12,
        }}
      >
        {caption ? (
          <span style={{ fontSize: 30, color: accent, letterSpacing: 2 }}>{caption}</span>
        ) : null}
        <span
          style={{
            fontFamily: SERIF,
            fontSize: 32,
            textAlign: 'center',
            marginTop: 16,
            lineHeight: 1.15,
          }}
        >
          {name}
        </span>
      </div>
    </div>
  );
}

export function ReadingCard({
  payload,
  art,
}: {
  payload: Extract<ShareCardPayload, { kind: 'reading' }>;
  /** Art as data URIs, keyed by `artPath`. */
  art: Record<string, string>;
}) {
  const accent = accentFor(payload.deckSystem);
  const many = payload.cards.length > 3;
  return (
    <Frame
      accent={accent}
      eyebrow={payload.eyebrow}
      footer={`${payload.deckName} · ${payload.spreadName}`}
    >
      <div style={{ ...col, gap: 10 }}>
        <span style={{ fontSize: 30, color: P.fgMuted }}>{payload.dateLabel}</span>
        {payload.question ? (
          <span style={{ fontFamily: SERIF, fontSize: 54, lineHeight: 1.15 }}>
            {payload.question}
          </span>
        ) : null}
      </div>
      <div style={{ ...row, gap: many ? 16 : 32, justifyContent: 'center', flexWrap: 'wrap' }}>
        {payload.cards.map((c, i) => (
          <div key={i} style={{ ...col, alignItems: 'center', gap: 14, width: many ? 160 : 260 }}>
            {c.artPath && art[c.artPath] ? (
              // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text -- an image being drawn into an image; satori has no <Image>
              <img
                src={art[c.artPath]}
                width={many ? 160 : 200}
                height={many ? 272 : 340}
                style={{ borderRadius: 12, ...(c.reversed ? { transform: 'rotate(180deg)' } : {}) }}
              />
            ) : (
              <TypographicFace
                name={c.name}
                caption={c.caption}
                accent={accent}
                reversed={c.reversed}
              />
            )}
            <span style={{ fontFamily: SERIF, fontSize: many ? 26 : 32, textAlign: 'center' }}>
              {c.name}
              {c.reversed ? ', reversed' : ''}
            </span>
            <span style={{ fontSize: 22, color: P.fgMuted, textAlign: 'center' }}>
              {c.position}
            </span>
          </div>
        ))}
      </div>
      {payload.note ? (
        <span
          style={{
            fontFamily: SERIF,
            fontStyle: 'italic',
            fontSize: 34,
            lineHeight: 1.35,
            color: P.fg,
          }}
        >
          “{payload.note}”
        </span>
      ) : null}
      {payload.themes.length || payload.entities ? (
        <div style={{ ...row, flexWrap: 'wrap', gap: 14 }}>
          {payload.themes.map((t) => (
            <Chip key={t} text={t} accent={accent} />
          ))}
          {payload.entities?.map((e) => (
            <Chip key={`e-${e}`} text={e} accent={P.fgMuted} />
          ))}
        </div>
      ) : null}
    </Frame>
  );
}

export function MonthCard({ payload }: { payload: Extract<ShareCardPayload, { kind: 'month' }> }) {
  const accent = accentFor(payload.deckSystem);
  const stat = (n: number, label: string) => (
    <div style={{ ...col, alignItems: 'flex-start' }}>
      <span style={{ fontFamily: SERIF, fontSize: 96, lineHeight: 1 }}>{n}</span>
      <span style={{ fontSize: 28, color: P.fgMuted }}>{label}</span>
    </div>
  );
  return (
    <Frame
      accent={accent}
      eyebrow={payload.eyebrow}
      footer="From a private journal, shared by choice"
    >
      <span style={{ fontFamily: SERIF, fontSize: 84, lineHeight: 1.05 }}>
        {payload.monthLabel}
      </span>
      <div style={{ ...row, gap: 64 }}>
        {stat(payload.readings, payload.readings === 1 ? 'reading' : 'readings')}
        {stat(payload.events, payload.events === 1 ? 'life event' : 'life events')}
        {stat(payload.outcomes, payload.outcomes === 1 ? 'outcome recorded' : 'outcomes recorded')}
      </div>
      {payload.recurring.length ? (
        <div style={{ ...col, gap: 16 }}>
          <span
            style={{ fontSize: 26, letterSpacing: 4, textTransform: 'uppercase', color: P.fgMuted }}
          >
            Kept coming back
          </span>
          {payload.recurring.map((r) => (
            <div key={r.name} style={{ ...row, alignItems: 'baseline', gap: 20 }}>
              <span style={{ fontFamily: SERIF, fontSize: 48 }}>{r.name}</span>
              <span style={{ fontSize: 28, color: accentFor(r.deckSystem) }}>
                {r.count} {r.count === 1 ? 'time' : 'times'}
              </span>
            </div>
          ))}
        </div>
      ) : null}
      {payload.themes.length || payload.journeys || payload.entities ? (
        <div style={{ ...row, flexWrap: 'wrap', gap: 14 }}>
          {payload.themes.map((t) => (
            <Chip key={t} text={t} accent={accent} />
          ))}
          {payload.journeys?.map((j) => (
            <Chip key={`j-${j}`} text={j} accent={P.fgMuted} />
          ))}
          {payload.entities?.map((e) => (
            <Chip key={`e-${e}`} text={e} accent={P.fgMuted} />
          ))}
        </div>
      ) : null}
    </Frame>
  );
}
