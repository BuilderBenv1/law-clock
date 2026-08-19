import type { MetadataRoute } from 'next';

/**
 * Makes the app installable from the phone's browser ("Add to Home Screen"),
 * which is how it gets used from a courthouse hallway — full screen, an icon on
 * the home screen, no app store.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Law Clock — ניהול שעות ומשרד',
    short_name: 'Law Clock',
    description: 'מדידת זמן לפי לקוח, תיק ומשימה — עם דוחות וחשבוניות בעברית.',
    start_url: '/',
    display: 'standalone',
    background_color: '#0b1220',
    theme_color: '#0b1220',
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
