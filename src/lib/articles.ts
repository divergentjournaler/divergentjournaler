
import { getCollection, render } from 'astro:content';

export interface ArticleMetadata {
  title: string;
  slug: string;
  categorySlug: string;
  date: string;
  modified?: string;
  description?: string;
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
}


const jsonFiles = import.meta.glob('../content/posts/**/*.json', {
  eager: true,
  import: 'default',
});

export function getAllArticles(): Article[] {
  return Object.values(jsonFiles) as Article[];
}

export async function getAllMarkdownEntries() {
  return await getCollection('markdown');
}

export async function getMarkdownTest() {
  const entries = await getCollection('markdown');
  const entry = entries.find((item) => item.id === 'bridge-test');

  if (!entry) {
    throw new Error('Bridge test article not found');
  }

  const { Content } = await render(entry);

  return {
    title: entry.data.title,
    Content,
  };
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
