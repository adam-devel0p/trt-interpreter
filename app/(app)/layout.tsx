import { AppShell } from '@/ui/components/app-shell';
import { BottomNav } from '@/ui/components/bottom-nav';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell nav={<BottomNav />}>{children}</AppShell>;
}
