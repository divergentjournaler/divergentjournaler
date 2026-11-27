import fs from 'node:fs';
import TurndownService from 'turndown';

const source = 'src/content/posts/journal-prompts/dialogues-weekly-prompts-03.json';

const article = JSON.parse(fs.readFileSync(source, 'utf8'));

const turndown = new TurndownService({
  headingStyle: 'atx',
  bulletListMarker: '-',
  codeBlockStyle: 'fenced',
  emDelimiter: '*',
  strongDelimiter: '**',
  hr: '---'
});

turndown.addRule('legacyImages', {
  filter: 'img',
  replacement: function (content, node) {
    const src = node.getAttribute('src');

    if (!src) return '';

    const url = new URL(src, 'https://divergentjournaler.com');

    if (
      url.hostname === 'divergentjournaler.com' &&
      url.pathname.startsWith('/wp-content/uploads/')
    ) {
      const relative = decodeURIComponent(url.pathname)
        .replace('/wp-content/uploads/', '');

      const style = node.getAttribute('style') || '';
      const width = node.getAttribute('width') ||
  style.match(/(?:^|;)\s*width:\s*(\d+)px/i)?.[1];

const size = width && /^\d+$/.test(width) ? `|${width}` : '';

const alt = (node.getAttribute('alt') || '').trim();
const description = alt ? `|${alt}` : '';

return `![[KORE/SITES/DIVERGENTJOURNALER/UPLOADS/LEGACY/${relative}${description}${size}]]`;
    }

    return `![${node.getAttribute('alt') || ''}](${src})`;
  }
});

turndown.addRule('legacySlideshows', {
  filter: function (node) {
    return node.nodeName === 'DIV' &&
      node.hasAttribute('data-slideshow-id');
  },
  replacement: function (content, node) {
    const id = node.getAttribute('data-slideshow-id');

    return `\n\n> [!slideshow] Slideshow\n> ${id}\n\n`;
  }
});

turndown.addRule('legacyVideoEmbeds', {
  filter: function (node) {
    return node.nodeName === 'DIV' &&
      node.classList.contains('wp-block-embed__wrapper');
  },
  replacement: function (content, node) {
    const url = node.textContent.trim();

    if (/^https?:\/\/(?:www\.)?(?:youtube\.com|youtu\.be)\//i.test(url)) {
      return `\n\n[Watch on YouTube](${url})\n\n`;
    }

    return content;
  }
});

const html = article.html.replace(
  /(<div\b[^>]*data-slideshow-id="[^"]+"[^>]*>)\s*<\/div>/gi,
  '$1SLIDESHOW_PLACEHOLDER</div>'
);

const markdown = turndown.turndown(html);

const meta = article.metadata;
const legacyRoot = 'KORE/SITES/DIVERGENTJOURNALER/UPLOADS/LEGACY/';

const primary = meta.categories.find(
  category => category.slug === meta.categorySlug
);

const additional = meta.categories.filter(
  category => category.slug !== meta.categorySlug
);

function legacyImagePath(ref) {
  if (!ref) return '';

  const url = new URL(ref, 'https://divergentjournaler.com');
  const pathname = decodeURIComponent(url.pathname);

  if (url.hostname === 'divergentjournaler.com') {
    if (pathname.startsWith('/wp-content/uploads/')) {
      return legacyRoot + pathname.replace('/wp-content/uploads/', '');
    }

    if (pathname.startsWith('/uploads/tools/')) {
      return legacyRoot + 'TOOLS/' + pathname.replace('/uploads/tools/', '');
    }
  }

  return ref;
}

const quote = value => JSON.stringify(value);
const formatDate = value => value.slice(0, 10).replace(/-/g, '.');

const frontmatter = [
  '---',
  `published-category: ${meta.categorySlug}`,
  `published-slug: ${meta.slug}`,
  `title: ${quote(meta.title)}`,
  `category: ${quote(primary.name)}`,
  ...(additional.length
    ? [
        'additional-categories:',
        ...additional.map(category => `  - ${quote(category.name)}`)
      ]
    : ['additional-categories: []']),
  `featuredImage: ${quote(legacyImagePath(meta.featuredImage))}`,
  ...(meta.featuredImage.includes('/uploads/tools/')
  ? ['featuredImageListingOnly: true']
  : []),
  'tags:',
  '  - divergentjournaler',
  ...(meta.tags.length
    ? [
        'site-tags:',
        ...meta.tags.map(tag => `  - ${quote('#' + tag.name)}`)
      ]
    : ['site-tags: []']),
  `date: ${formatDate(meta.date)}`,
  `last-update: ${formatDate(meta.modified)}`,
  `original-date: ${quote(meta.date)}`,
  `original-modified: ${quote(meta.modified)}`,
  '---'
].join('\n');

console.log(frontmatter + '\n\n' + markdown);