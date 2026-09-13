'use client';

import * as React from 'react';

export function formatReadingDate(
  iso: string,
  opts: { dateOnly?: boolean; timeZone?: string; locale?: string } = {},
): string {
  return new Intl.DateTimeFormat(opts.locale ?? 'en', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    ...(opts.dateOnly ? {} : { hour: 'numeric', minute: '2-digit' }),
    timeZone: opts.timeZone,
  }).format(new Date(iso));
}

/**
 * A timestamp rendered server-side in UTC, then re-rendered in the viewer's own zone once
 * mounted. The `<time dateTime>` carries the exact instant either way.
 */
export function LocalTime({ iso, dateOnly = false }: { iso: string; dateOnly?: boolean }) {
  const [text, setText] = React.useState(() =>
    formatReadingDate(iso, { dateOnly, timeZone: 'UTC' }),
  );
  React.useEffect(() => {
    setText(formatReadingDate(iso, { dateOnly }));
  }, [iso, dateOnly]);
  return (
    <time dateTime={iso} suppressHydrationWarning>
      {text}
    </time>
  );
}
