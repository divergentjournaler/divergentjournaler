
import type { Article } from './articles';

const categoryFallbacks: Record<string, string> = {
  'creative-playground': '/uploads/tools/playground.png',
  'divergent-dialogues': '/uploads/tools/prompts.png',
  'free-journal-resources': '/uploads/tools/freebies.png',
  'journal-prompts': '/uploads/tools/prompts.png',
  'journaling': '/uploads/tools/article.png',
};

function firstImageFromHtml(html: string): string | undefined {
  return html.match(/<img\b[^>]*\bsrc=["']([^"']+)["']/i)?.[1];
}

export function getFeaturedImage(
  article: Article,
  options: { context?: 'article' | 'listing' } = {}
): string | null {
  const context = options.context ?? 'listing';
  const category = article.metadata.categorySlug;

  // Preserve the existing Journal Prompts listing exception.
  if (context === 'listing' && category === 'journal-prompts') {
    return categoryFallbacks[category] ?? null;
  }

  // An explicitly selected featured image takes priority.
  if (article.metadata.featuredImage) {
    return article.metadata.featuredImage;
  }

  // Existing JSON articles store their body images in HTML.
  const firstImage = firstImageFromHtml(article.html ?? '');

  if (firstImage) {
    return firstImage;
  }

  return categoryFallbacks[category] ?? null;
}
