'use client';

import { useEffect } from 'react';

/** Registers the offline app-shell service worker. Production only; dev keeps HMR simple. */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {
      /* offline shell is a progressive enhancement */
    });
  }, []);
  return null;
}
