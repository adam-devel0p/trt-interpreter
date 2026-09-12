import type { Metadata, Viewport } from 'next';
import '@fontsource-variable/newsreader';
import '@fontsource-variable/dm-sans';
import './globals.css';
import { MotionProvider } from '@/ui/motion';
import { THEME_COLORS } from '@/ui/theme-colors';
import { ServiceWorkerRegistration } from '@/ui/components/sw-registration';

export const metadata: Metadata = {
  title: { default: 'Tarot Journal', template: '%s · Tarot Journal' },
  description: 'A private tarot journal that remembers your readings over time.',
  applicationName: 'Tarot Journal',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'Tarot Journal' },
  icons: {
    icon: [{ url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180' }],
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: THEME_COLORS.lightBg },
    { media: '(prefers-color-scheme: dark)', color: THEME_COLORS.darkBg },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-deck="rws" suppressHydrationWarning>
      <body>
        <MotionProvider>{children}</MotionProvider>
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
