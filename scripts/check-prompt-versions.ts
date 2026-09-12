/**
 * CI gate (docs/TESTING.md#ci-gates): editing src/ai/tasks/<task>/prompt.ts or schema.ts
 * without bumping that task's version.ts fails. Compares against BASE_REF (default origin/main).
 */
import { execSync } from 'node:child_process';

const base = process.env.BASE_REF ?? 'origin/main';

function changedFiles(): string[] {
  try {
    const out = execSync(`git diff --name-only ${base}...HEAD`, { encoding: 'utf8' });
    return out.split('\n').filter(Boolean);
  } catch {
    console.log(`check-prompt-versions: cannot diff against ${base}; skipping`);
    return [];
  }
}

const files = changedFiles();
const taskDir = /^src\/ai\/tasks\/([^/]+)\//;
const touched = new Map<string, { promptOrSchema: boolean; version: boolean }>();
for (const f of files) {
  const m = taskDir.exec(f);
  if (!m?.[1]) continue;
  const entry = touched.get(m[1]) ?? { promptOrSchema: false, version: false };
  if (/\/(prompt|schema)\.ts$/.test(f)) entry.promptOrSchema = true;
  if (/\/version\.ts$/.test(f)) entry.version = true;
  touched.set(m[1], entry);
}

const violations = [...touched].filter(([, v]) => v.promptOrSchema && !v.version).map(([t]) => t);
if (violations.length > 0) {
  console.error(
    `Prompt or schema changed without a version bump in: ${violations.join(', ')}\n` +
      "Bump PROMPT_VERSION / SCHEMA_VERSION in that task's version.ts.",
  );
  process.exit(1);
}
console.log(`check-prompt-versions: ok (${touched.size} task dir(s) touched)`);
