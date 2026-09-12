import { notFound } from 'next/navigation';

/** Everything under /dev is development-only. */
export default function DevLayout({ children }: { children: React.ReactNode }) {
  if (process.env.NODE_ENV === 'production' && process.env.NEXT_PUBLIC_APP_ENV === 'production') {
    notFound();
  }
  return <main className="mx-auto w-full max-w-[720px] px-4 pb-16">{children}</main>;
}
