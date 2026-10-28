
import type { Article } from './articles';
import settings from '../data/site.settings.data.json';

const categoryFallbacks: Record<string, string> =
  settings.featuredImages.categoryFallbacks;

const forceCategoryImageInListings: string[] =
  settings.featuredImages.forceCategoryImageInListings;

function firstImageFromHtml(html: string): string | undefined {
  return html.match(/<img\b[^>]*\bsrc=["']([^"']+)["']/i)?.[1];
}

export function getFeaturedImage(
  article: Article,
  options: { context?: 'article' | 'listing' } = {}
): string | null {
  const context = options.context ?? 'listing';
  const category = article.metadata.categorySlug;

  // Some categories always use their default image in listings.
if (
  context === 'listing' &&
  forceCategoryImageInListings.includes(category)
) {
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
