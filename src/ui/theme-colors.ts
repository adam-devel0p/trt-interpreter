/**
 * The only file allowed to hold colour literals outside tokens.css. Used where CSS variables
 * cannot reach: the PWA manifest and <meta name="theme-color">. MUST mirror --bg in tokens.css.
 */
export const THEME_COLORS = {
  lightBg: '#f5efe4',
  darkBg: '#121010',
} as const;
