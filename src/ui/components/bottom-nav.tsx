'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '../lib/cn';

export interface NavItem {
  href: string;
  label: string;
  icon: React.ReactNode;
}

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

/** Five tabs per §5. Icons are inline SVG so they inherit currentColor and scale with text. */
export const NAV_ITEMS: NavItem[] = [
  {
    href: '/home',
    label: 'Home',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true" className="size-6" {...stroke}>
        <path d="M4 11.5 12 5l8 6.5V19a1 1 0 0 1-1 1h-4v-5h-6v5H5a1 1 0 0 1-1-1z" />
      </svg>
    ),
  },
  {
    href: '/journal',
    label: 'Journal',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true" className="size-6" {...stroke}>
        <path d="M6 4h11a1 1 0 0 1 1 1v15H7a1 1 0 0 1-1-1z" />
        <path d="M6 17h12M9 8h6M9 11h6" />
      </svg>
    ),
  },
  {
    href: '/journey',
    label: 'Journey',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true" className="size-6" {...stroke}>
        <path d="M5 19c4-1 3-8 8-9s3-5 6-6" />
        <circle cx="5" cy="19" r="1.5" />
        <circle cx="19" cy="4" r="1.5" />
      </svg>
    ),
  },
  {
    href: '/ask',
    label: 'Ask',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true" className="size-6" {...stroke}>
        <path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-7l-5 4v-4H6a2 2 0 0 1-2-2z" />
      </svg>
    ),
  },
  {
    href: '/profile',
    label: 'Profile',
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden="true" className="size-6" {...stroke}>
        <circle cx="12" cy="8.5" r="3.5" />
        <path d="M5 20a7 7 0 0 1 14 0" />
      </svg>
    ),
  },
];

export function BottomNav({ items = NAV_ITEMS }: { items?: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-hairline bg-surface/95 safe-bottom backdrop-blur"
    >
      <ul className="mx-auto flex max-w-[720px] items-stretch justify-around">
        {items.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <li key={item.href} className="flex-1">
              <Link
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex min-h-14 flex-col items-center justify-center gap-0.5 text-[0.6875rem] font-medium transition-colors',
                  active ? 'text-accent' : 'text-fg-muted hover:text-fg',
                )}
              >
                {item.icon}
                <span>{item.label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
