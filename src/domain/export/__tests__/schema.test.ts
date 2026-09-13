import { describe, expect, it } from 'vitest';
import { EXPORT_FILES, EXPORT_SCHEMA_VERSION, validateExport } from '../schema';

const uuid = '11111111-1111-4111-8111-111111111111';

function minimal(): Record<string, unknown> {
  const files: Record<string, unknown> = {
    'manifest.json': {
      schema_version: EXPORT_SCHEMA_VERSION,
      app: 'tarot-journal',
      exported_at: '2026-09-13T00:00:00.000Z',
      user_id: uuid,
      counts: Object.fromEntries(EXPORT_FILES.map((f) => [f, f === 'profile.json' ? 1 : 0])),
      files: [...EXPORT_FILES],
      notes: [],
    },
    'profile.json': {
      id: uuid,
      email: null,
      locale: 'en',
      timezone: 'UTC',
      usage_style: null,
      experience_level: null,
      default_deck_id: null,
      use_reversals: true,
      ai_consent_at: null,
      ai_explanation_depth: 'standard',
      plan: 'free',
      created_at: '2026-09-13T00:00:00.000Z',
    },
  };
  for (const f of EXPORT_FILES) if (f !== 'profile.json') files[f] = [];
  return files;
}

describe('export contract', () => {
  it('accepts a minimal archive and reports nothing', () => {
    const { manifest, problems } = validateExport(minimal());
    expect(problems).toEqual([]);
    expect(manifest.user_id).toBe(uuid);
  });

  it('reports a missing file, a malformed row and a count mismatch by name', () => {
    const files = minimal();
    delete files['links.json'];
    (files['readings.json'] as unknown[]).push({ id: 'not-a-uuid' });
    const { problems } = validateExport(files);
    expect(problems.some((p) => p.startsWith('links.json'))).toBe(true);
    expect(problems.some((p) => p.startsWith('readings.json'))).toBe(true);
    const off = minimal();
    (off['spreads.json'] as unknown[]).push({
      id: uuid,
      slug: 'x',
      name: 'X',
      description: '',
      positions: [],
      layout: {},
      is_builtin: true,
      card_count: 1,
    });
    expect(validateExport(off).problems).toEqual(['spreads.json: manifest says 0, has 1']);
  });

  it('refuses an unknown schema version or a foreign app', () => {
    const files = minimal();
    (files['manifest.json'] as { schema_version: string }).schema_version = 'export/9.0.0';
    expect(validateExport(files).problems).toEqual(['manifest.json invalid']);
  });
});
