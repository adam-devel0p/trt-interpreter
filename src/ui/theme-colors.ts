/**
 * The only file allowed to hold colour literals outside tokens.css. Used where CSS variables
 * cannot reach: the PWA manifest, <meta name="theme-color">, and the server-rendered share
 * card image (Phase 11), which is drawn without a stylesheet. MUST mirror tokens.css.
 */
export const THEME_COLORS = {
  lightBg: '#f5efe4',
  darkBg: '#121010',
} as const;

/** The dark palette of tokens.css, for the share-card renderer (an image, not a page). */
export const SHARE_PALETTE = {
  bg: '#121010',
  surface: '#1b1816',
  fg: '#ede6da',
  fgMuted: '#a79e92',
  hairline: '#332d28',
  hairlineStrong: '#4a423a',
  accentRws: '#d9a64a',
  accentThoth: '#b4a3ee',
  accentMixed: '#c9b48f',
} as const;
