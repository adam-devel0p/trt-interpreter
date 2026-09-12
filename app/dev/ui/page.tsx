import { PageHeader } from '@/ui/components/page-header';
import { Gallery } from './gallery';

export const metadata = { title: 'UI gallery' };

export default function DevUiPage() {
  return (
    <>
      <PageHeader
        title="Component gallery"
        eyebrow="dev only"
        description="Every base component, in both themes and both deck accents. Designed at 390px."
      />
      <Gallery />
    </>
  );
}
