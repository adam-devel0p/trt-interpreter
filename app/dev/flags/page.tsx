import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { serverEnv } from '@/config/env.server';
import { allFlags, FLAGS, type FlagName } from '@/flags';
import { envKeyFor, isFlagName } from '@/flags/flags';
import { DEV_FLAGS_COOKIE, parseSessionOverrides } from '@/flags/resolve';
import { Button } from '@/ui/components/button';
import { PageHeader } from '@/ui/components/page-header';

export const dynamic = 'force-dynamic';

async function setOverride(formData: FormData) {
  'use server';
  const name = String(formData.get('flag'));
  const action = String(formData.get('action'));
  if (!isFlagName(name)) return;
  const store = await cookies();
  const current = parseSessionOverrides(store.get(DEV_FLAGS_COOKIE)?.value);
  if (action === 'clear') delete current[name];
  else current[name] = action === 'on';
  store.set(DEV_FLAGS_COOKIE, encodeURIComponent(JSON.stringify(current)), {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
  });
  revalidatePath('/dev/flags');
}

export default async function DevFlagsPage() {
  const env = serverEnv();
  const resolved = await allFlags();
  const store = await cookies();
  const overrides = parseSessionOverrides(store.get(DEV_FLAGS_COOKIE)?.value);

  return (
    <>
      <PageHeader
        title="Feature flags"
        eyebrow="dev only"
        description="Session overrides apply to this browser only, via a cookie. Env defaults are read-only here."
      />
      <ul className="divide-y divide-hairline rounded-card bg-surface hairline">
        {FLAGS.map((flag: FlagName) => {
          const envDefault = env[envKeyFor(flag)];
          const override = overrides[flag];
          return (
            <li key={flag} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1">
                <p className="font-mono text-sm">{flag}</p>
                <p className="text-xs text-fg-muted">
                  env {envDefault ? 'on' : 'off'}
                  {override !== undefined ? ` · session ${override ? 'on' : 'off'}` : ''}
                  {' · '}
                  <span className={resolved[flag] ? 'text-accent' : ''}>
                    resolved {resolved[flag] ? 'ON' : 'off'}
                  </span>
                </p>
              </div>
              <form action={setOverride} className="flex gap-1">
                <input type="hidden" name="flag" value={flag} />
                <Button name="action" value="on" size="sm" variant="secondary">
                  on
                </Button>
                <Button name="action" value="off" size="sm" variant="secondary">
                  off
                </Button>
                <Button name="action" value="clear" size="sm" variant="ghost">
                  clear
                </Button>
              </form>
            </li>
          );
        })}
      </ul>
    </>
  );
}
