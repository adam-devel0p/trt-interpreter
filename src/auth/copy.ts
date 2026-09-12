/**
 * Auth copy. Deliberately generic on failure: nothing here says whether an address exists
 * (§11). Written in the product voice — plain, second person, unhurried.
 */
export const AUTH_COPY = {
  signInFailed: "That email and password don't match. Check both and try again.",
  signUpFailed:
    "We couldn't create an account with those details. If you already have one, sign in instead.",
  linkSent:
    'If that address can receive mail from us, a link is on its way. It works for one hour.',
  rateLimited: 'Too many attempts for now. Wait a few minutes and try again.',
  passwordUpdated: 'Your password is updated.',
  passwordUpdateFailed: "We couldn't update your password. Request a new link and try again.",
  oauthUnavailable: "Google sign-in isn't available right now. Use email instead.",
  sessionRequired: 'Sign in to continue.',
  invalidEmail: 'Enter a valid email address.',
  passwordTooShort: 'Use at least 8 characters.',
  passwordsDoNotMatch: 'Both passwords need to match.',
} as const;
