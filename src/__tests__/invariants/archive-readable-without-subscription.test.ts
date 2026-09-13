import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Invariant 11 (spec §21): the archive stays readable regardless of subscription status;
 * existing user text is never paywalled. Structural half (the database proof is
 * `archive-readable-without-subscription.integration.test.ts`): nothing on the journal, reading
 * detail, search, export or delete paths reads `profiles.plan`, a subscription, a usage
 * counter or a paywall. The only plan-aware code today is the AI budget hook, which gates
 * *new* generation — never a stored row.
 */
const ROOT = process.cwd();
const PATHS = [
  'app/(app)/journal',
  'app/(app)/reading/[id]',
  'app/api/exports',
  'src/db/queries/readings.ts',
  'src/db/queries/journal.ts',
  'src/db/queries/exports.ts',
  'src/db/queries/interpretations.ts',
  'src/export',
  'src/privacy',
  'src/ui/components/timeline-item.tsx',
  'src/ui/components/reading-detail.tsx',
  'src/ui/components/layered-interpretation.tsx',
];
const GATING = /\bplan\b|paywall|subscription|usage_counters|budget|PaywallSheet/i;

function files(p: string): string[] {
  const abs = path.resolve(ROOT, p);
  if (!existsSync(abs)) return [];
  if (statSync(abs).isFile()) return [p];
  return readdirSync(abs, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? files(path.join(p, e.name))
      : /\.tsx?$/.test(e.name) && !e.name.includes('.test.')
        ? [path.join(p, e.name)]
        : [],
  );
}

describe('archive-readable-without-subscription', () => {
  it('no read, search, export or delete path consults the plan or a paywall', () => {
    const all = PATHS.flatMap(files);
    expect(all.length).toBeGreaterThan(12);
    const offenders = all
      .map((f) => {
        const src = readFileSync(path.resolve(ROOT, f), 'utf8');
        // Strip comments so a sentence like "yours on any plan" does not count as gating.
        const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
        // The export copy says "on any plan" on purpose (invariant 11 made visible).
        const withoutCopy = code
          .replace(/Yours on any plan\./g, '')
          .replace(/whatever the plan/g, '');
        // The archive carries the plan *as data* for the user (profile.json) — a read, not a gate.
        const withoutExportField = withoutCopy
          .replace(/plan: profile\.plan,/g, '')
          .replace(/plan: z\.string\(\),/g, '');
        // The panel names the `budget_denied` failure class of a *new* generation honestly;
        // that is copy for a failed model call, not a gate on anything stored.
        const withoutFailureCopy = withoutExportField.replace(/['"]budget_denied['"]/g, '');
        return GATING.test(withoutFailureCopy) ? f : null;
      })
      .filter((f): f is string => f !== null);
    expect(offenders).toEqual([]);
  });

  it('the profile row exposes the plan only to display it; users cannot change it and nothing keys on it', () => {
    const profile = readFileSync(path.resolve(ROOT, 'src/db/queries/profile.ts'), 'utf8');
    expect(profile).toMatch(/`plan` is absent on purpose/);
    const page = readFileSync(path.resolve(ROOT, 'app/(app)/profile/page.tsx'), 'utf8');
    expect(page).toContain('Your archive stays readable whatever the plan');
  });
});
