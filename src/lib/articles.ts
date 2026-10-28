
import { getCollection, render } from 'astro:content';

export interface ArticleMetadata {
  title: string;
  slug: string;
  categorySlug: string;
  date: string;
  modified?: string;
  description?: string;
  featuredImageAuto?: boolean;
  featuredImage?: string;
  originalUrl?: string;
  categories: {
    name: string;
    slug: string;
  }[];
  tags: {
    name: string;
    slug: string;
  }[];
  showTitle?: boolean;
  showModifiedDate?: boolean;
}

export interface Article {
  metadata: ArticleMetadata;
  html: string;
  source?: 'json' | 'markdown';
}

const jsonFiles = import.meta.glob('../content/posts/**/*.json', {
  eager: true,
  import: 'default',
});

export function getAllArticles(): Article[] {
  return (Object.values(jsonFiles) as Article[]).map((article) => ({
    ...article,
    source: 'json',
  }));
}

export async function getAllMarkdownEntries() {
  return await getCollection('markdown');
}

function toSlug(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function markdownToMetadata(data: Record<string, any>): ArticleMetadata {
  const category = String(data.category || 'Creative Playground');
  const categorySlug = toSlug(category);

  const websiteTags = Array.isArray(data['site-tags'])
    ? data['site-tags']
    : [];

  return {
    title: String(data.title),
    slug: toSlug(String(data.slug || data.title)),
    categorySlug,
    date: String(data.date).replace(/\./g, '-'),
    description: data.description || undefined,
    featuredImage: data.featuredImage
  ? String(data.featuredImage)
  : undefined,
    categories: [
      {
        name: category,
        slug: categorySlug,
      },
    ],
    tags: websiteTags.map((tag: string) => ({
      name: String(tag),
      slug: toSlug(String(tag)),
    })),
  };
}


export async function getMarkdownArticles(): Promise<Article[]> {
  const entries = await getAllMarkdownEntries();

  return entries.map((entry) => {
    const firstImage = entry.body?.match(
      /!\[[^\]]*\]\(([^)\s]+(?:%20[^)\s]*)*)\)/
    )?.[1];

    const metadata = markdownToMetadata(entry.data);
    metadata.slug = entry.id;
    if (!metadata.featuredImage && firstImage) {
  metadata.featuredImage = firstImage;
  metadata.featuredImageAuto = true;
}

    return {
      metadata,
      html: (entry.body ?? '')
  .replace(/!\[[^\]]*\]\([^)]+\)/g, ' ')
  .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
  .replace(/^[#>*\-\s]+/gm, '')
  .replace(/[*_`~]/g, ''),
      source: 'markdown' as const,
    };
  });
}

export async function getAllUnifiedArticles(): Promise<Article[]> {
  const jsonArticles = getAllArticles();
  const markdownArticles = await getMarkdownArticles();

  return [...jsonArticles, ...markdownArticles];
}
