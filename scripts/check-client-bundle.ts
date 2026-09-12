/**
 * CI gate: the client bundle must never contain a provider key or the service-role key.
 * Run after `pnpm build`. Scans .next/static for known key shapes.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const PATTERNS: Array<[string, RegExp]> = [
  ['Anthropic API key', /sk-ant-[A-Za-z0-9_-]{20,}/],
  ['OpenAI API key', /sk-(?:proj-)?[A-Za-z0-9]{20,}/],
  ['Supabase secret key', /sb_secret_[A-Za-z0-9_-]{10,}/],
  [
    'Supabase service-role JWT',
    /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]*c2VydmljZV9yb2xl[A-Za-z0-9_-]*\./,
  ],
  ['service role env name', /SUPABASE_SERVICE_ROLE_KEY/],
  ['jobs secret env name', /JOBS_RUN_SECRET/],
  ['database url', /postgres(?:ql)?:\/\/[^\s"']+@/],
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(js|mjs|css|json|txt)$/.test(name)) out.push(p);
  }
  return out;
}

const root = path.resolve('.next/static');
let files: string[] = [];
try {
  files = walk(root);
} catch {
  console.error('check-client-bundle: .next/static not found — run `pnpm build` first');
  process.exit(1);
}

const hits: string[] = [];
for (const f of files) {
  const text = readFileSync(f, 'utf8');
  for (const [label, re] of PATTERNS) {
    if (re.test(text)) hits.push(`${label} in ${path.relative(process.cwd(), f)}`);
  }
}
if (hits.length > 0) {
  console.error('Client bundle contains secrets:\n  ' + hits.join('\n  '));
  process.exit(1);
}
console.log(`check-client-bundle: ok (${files.length} files scanned)`);
