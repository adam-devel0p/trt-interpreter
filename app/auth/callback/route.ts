import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { requestOrigin } from '@/auth/origin';
import { safeReturnPath, SIGN_IN_PATH } from '@/auth/routes';
import { getSessionClient } from '@/auth/session';
import { logger } from '@/observability/logger';

/**
 * Where every email link and OAuth redirect lands. Exchanges the PKCE `code` (OAuth, magic
 * link, recovery) or verifies a `token_hash` (email templates that use it), sets the session
 * cookies, then continues to a same-origin `next`. Failures go back to sign-in with a neutral
 * hint — never a stack trace, never a reason that reveals account state.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type') as EmailOtpType | null;
  const next = safeReturnPath(url.searchParams.get('next'));
  const origin = requestOrigin((n) => request.headers.get(n));

  const supabase = await getSessionClient();
  let ok = false;
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    ok = !error;
    if (error)
      logger.info('auth.callback.exchange_failed', { errorClass: error.code ?? error.name });
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    ok = !error;
    if (error) logger.info('auth.callback.verify_failed', { errorClass: error.code ?? error.name });
  }

  if (ok) {
    logger.info('auth.callback.ok', { route: next });
    return NextResponse.redirect(new URL(next, origin));
  }
  return NextResponse.redirect(new URL(`${SIGN_IN_PATH}?link=expired`, origin));
}
