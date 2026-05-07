import { createFromSource } from 'fumadocs-core/search/server';
import { source } from '@/lib/source';

export const revalidate = false;
export const { staticGET: GET } = createFromSource(source, {
  localeMap: {
    cn: { language: 'english' },
  },
});

export function generateStaticParams() {
  return [{ lang: 'en' }, { lang: 'cn' }];
}
