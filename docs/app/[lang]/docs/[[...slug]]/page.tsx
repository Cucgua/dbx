import { source } from '@/lib/source';
import { notFound } from 'next/navigation';
import {
  DocsPage,
  DocsBody,
  DocsTitle,
  DocsDescription,
} from 'fumadocs-ui/page';
import defaultMdxComponents from 'fumadocs-ui/mdx';
import { Tab, Tabs } from 'fumadocs-ui/components/tabs';
import { Step, Steps } from 'fumadocs-ui/components/steps';
import { Callout } from 'fumadocs-ui/components/callout';
import { Card, Cards } from 'fumadocs-ui/components/card';
import { ImageZoom } from 'fumadocs-ui/components/image-zoom';
import { Accordion, Accordions } from 'fumadocs-ui/components/accordion';
import type { MDXContent } from 'mdx/types';
import type { TOCItemType } from 'fumadocs-core/toc';

const mdxComponents = {
  ...defaultMdxComponents,
  Tab,
  Tabs,
  Step,
  Steps,
  Callout,
  Card,
  Cards,
  ImageZoom,
  Accordion,
  Accordions,
};

export default async function Page({
  params,
}: {
  params: Promise<{ lang: string; slug?: string[] }>;
}) {
  const { lang, slug } = await params;
  const page = source.getPage(slug, lang);
  if (!page) notFound();

  const { body: MDX, toc } = page.data as unknown as {
    body: MDXContent;
    toc: TOCItemType[];
  };

  return (
    <DocsPage toc={toc}>
      <DocsTitle>{page.data.title}</DocsTitle>
      <DocsDescription>{page.data.description}</DocsDescription>
      <DocsBody>
        <MDX components={mdxComponents} />
      </DocsBody>
    </DocsPage>
  );
}

export function generateStaticParams() {
  return source.generateParams().map((params) => ({
    lang: params.lang,
    slug: params.slug,
  }));
}
