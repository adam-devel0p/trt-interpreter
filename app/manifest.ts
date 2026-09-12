import type { MetadataRoute } from 'next';
import { THEME_COLORS } from '@/ui/theme-colors';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Tarot Journal',
    short_name: 'Tarot',
    description: 'A private tarot journal that remembers your readings over time.',
    start_url: '/home',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: THEME_COLORS.lightBg,
    theme_color: THEME_COLORS.lightBg,
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      {
        src: '/icons/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
