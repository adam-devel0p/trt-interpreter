/**
 * Pure resolution order: env default → per-user override → dev session override.
 * Later layers only apply when present; `undefined` means "no opinion".
 */
export interface FlagLayers {
  envDefault: boolean;
  userOverride?: boolean | undefined;
  sessionOverride?: boolean | undefined;
  /** Session overrides are ignored outside development/test. */
  allowSessionOverride: boolean;
}

export function resolveFlag(layers: FlagLayers): boolean {
  if (layers.allowSessionOverride && layers.sessionOverride !== undefined)
    return layers.sessionOverride;
  if (layers.userOverride !== undefined) return layers.userOverride;
  return layers.envDefault;
}

export const DEV_FLAGS_COOKIE = 'dev_flags';

/** Parses the dev cookie (`{"ai_extraction":true}`); malformed input → no overrides. */
export function parseSessionOverrides(raw: string | undefined): Partial<Record<string, boolean>> {
  if (!raw) return {};
  try {
    const obj: unknown = JSON.parse(decodeURIComponent(raw));
    if (typeof obj !== 'object' || obj === null) return {};
    const out: Partial<Record<string, boolean>> = {};
    for (const [k, v] of Object.entries(obj)) if (typeof v === 'boolean') out[k] = v;
    return out;
  } catch {
    return {};
  }
}
