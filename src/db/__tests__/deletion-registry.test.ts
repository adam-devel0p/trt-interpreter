import { describe, expect, it } from 'vitest';
import * as schema from '@/db/schema';
import { coveredTables, DELETION_REGISTRY } from '@/domain/privacy/deletionRegistry';
import { userOwnedTablesMissingFromRegistry } from '@/domain/privacy/registryCheck';

describe('deletion registry', () => {
  it('covers every user-owned table in the schema', () => {
    expect(userOwnedTablesMissingFromRegistry(schema)).toEqual([]);
  });

  it('reads Drizzle tables structurally (sanity check on the detector)', () => {
    expect(coveredTables()).toEqual(
      new Set([
        'jobs',
        'profiles',
        'user_flags',
        'reminder_settings',
        'spreads',
        'readings',
        'reading_cards',
        'reading_drafts',
        'interpretations',
        'safety_flags',
        'question_embeddings',
        'ai_calls',
        'reading_note_revisions',
        'deletion_receipts',
        'exports',
        'extractions',
        'metadata_overrides',
        'themes',
        'object_themes',
        'entities',
        'entity_aliases',
        'entity_roles',
        'entity_mentions',
        'entity_merges',
        'predictions',
        'journeys',
        'journey_members',
        'journey_theme_progression',
        'life_events',
        'event_media',
        'outcomes',
        'links',
      ]),
    );
    // Simulate a new user-owned table that nobody registered.
    const fake = { ...schema, ghost: cloneWithName(schema.reminderSettings, 'ghost_table') };
    expect(userOwnedTablesMissingFromRegistry(fake)).toEqual(['ghost_table']);
  });

  it('has an entry for every root type', () => {
    expect(Object.keys(DELETION_REGISTRY).sort()).toEqual([
      'entity',
      'journey',
      'life_event',
      'reading',
      'user',
    ]);
  });
});

function cloneWithName(table: object, name: string): object {
  const clone = Object.create(Object.getPrototypeOf(table));
  for (const sym of Object.getOwnPropertySymbols(table)) {
    clone[sym] = (table as Record<symbol, unknown>)[sym];
  }
  const nameSym = Object.getOwnPropertySymbols(table).find((s) => s.description === 'drizzle:Name');
  if (nameSym) clone[nameSym] = name;
  return clone;
}
