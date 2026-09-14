import 'server-only';
import webpush from 'web-push';
import { serverEnv } from '@/config/env.server';
import { errorClassOf, logger } from '@/observability/logger';

/**
 * Delivery adapters (§15.2). Web Push through VAPID and email through Resend when
 * `NOTIFICATION_DELIVERY=live`; the `log` mode records the delivery without sending, so
 * every environment without keys still exercises the whole dispatcher. A push endpoint the
 * service reports gone (404 / 410) is returned as `gone` so the caller can disable it.
 */
export interface PushMessage {
  title: string;
  body: string;
  /** Where a tap goes (the signed open link). */
  url: string;
  /** One-tap unsubscribe from the notification's own action button. */
  unsubscribeUrl: string;
  tag: string;
}

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export type PushOutcome = { ok: true } | { ok: false; gone: boolean; errorClass: string };

export interface PushSender {
  readonly id: string;
  send(target: PushTarget, message: PushMessage): Promise<PushOutcome>;
}

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface EmailSender {
  readonly id: string;
  send(message: EmailMessage): Promise<{ ok: true } | { ok: false; errorClass: string }>;
}

export const logPushSender: PushSender = {
  id: 'log',
  async send() {
    return { ok: true };
  },
};

export const logEmailSender: EmailSender = {
  id: 'log',
  async send() {
    return { ok: true };
  },
};

export function createWebPushSender(cfg: {
  publicKey: string;
  privateKey: string;
  subject: string;
}): PushSender {
  webpush.setVapidDetails(cfg.subject, cfg.publicKey, cfg.privateKey);
  return {
    id: 'web-push',
    async send(target, message) {
      try {
        await webpush.sendNotification(
          { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
          JSON.stringify(message),
          { TTL: 60 * 60 * 12, urgency: 'normal' },
        );
        return { ok: true };
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        return { ok: false, gone: status === 404 || status === 410, errorClass: errorClassOf(err) };
      }
    },
  };
}

export function createResendEmailSender(cfg: { apiKey: string; from: string }): EmailSender {
  return {
    id: 'resend',
    async send(message) {
      try {
        const res = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: { authorization: `Bearer ${cfg.apiKey}`, 'content-type': 'application/json' },
          body: JSON.stringify({
            from: cfg.from,
            to: [message.to],
            subject: message.subject,
            text: message.text,
            html: message.html,
          }),
        });
        if (!res.ok) return { ok: false, errorClass: `http_${res.status}` };
        return { ok: true };
      } catch (err) {
        return { ok: false, errorClass: errorClassOf(err) };
      }
    },
  };
}

let push: PushSender | undefined;
let email: EmailSender | undefined;

export function getPushSender(): PushSender {
  if (push) return push;
  const env = serverEnv();
  if (env.NOTIFICATION_DELIVERY === 'live' && env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY) {
    push = createWebPushSender({
      publicKey: env.VAPID_PUBLIC_KEY,
      privateKey: env.VAPID_PRIVATE_KEY,
      subject: env.VAPID_SUBJECT,
    });
  } else {
    if (env.NOTIFICATION_DELIVERY === 'live')
      logger.warn('retention.push_not_configured', { reason: 'vapid_keys_missing' });
    push = logPushSender;
  }
  return push;
}

export function getEmailSender(): EmailSender {
  if (email) return email;
  const env = serverEnv();
  if (
    env.NOTIFICATION_DELIVERY === 'live' &&
    env.EMAIL_PROVIDER === 'resend' &&
    env.RESEND_API_KEY
  ) {
    email = createResendEmailSender({ apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM });
  } else {
    if (env.NOTIFICATION_DELIVERY === 'live')
      logger.warn('retention.email_not_configured', { reason: 'provider_or_key_missing' });
    email = logEmailSender;
  }
  return email;
}

/** Test-only. */
export function setSendersForTests(p?: PushSender, e?: EmailSender): void {
  push = p;
  email = e;
}
