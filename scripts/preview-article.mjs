import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VAULT = path.join(process.env.HOME, 'Vaults', 'Kaoverse');
const SITE = path.join(VAULT, 'KORE', 'SITES', 'DIVERGENTJOURNALER');
const SOURCE_IMAGES = path.join(SITE, 'UPLOADS', 'IMAGES');
const GRAVEYARD = path.join(ROOT, '.graveyard');
const DRAFTS = path.join(GRAVEYARD, 'drafts');
const IMAGES = path.join(GRAVEYARD, 'images');
const PREVIEW = path.join(DRAFTS, 'preview.md');

const relativePath = process.argv[2];

if (!relativePath || !relativePath.endsWith('.md')) {
  throw new Error('Expected an Obsidian Markdown article path.');
}

const source = path.resolve(VAULT, relativePath);
const allowed = ['DRAFTS', 'PUBLISHED'].some(folder => {
  const dir = path.join(SITE, folder);
  return path.dirname(source) === dir;
});

if (!allowed) {
  throw new Error('Article must be in DIVERGENTJOURNALER/DRAFTS or PUBLISHED.');
}

let markdown = fs.readFileSync(source, 'utf8');
const imageFiles = new Map();

function registerImage(reference) {
  const filename = path.basename(reference.split('|')[0].trim());
  const sourceFile = path.join(SOURCE_IMAGES, filename);

  if (!fs.existsSync(sourceFile) || !fs.statSync(sourceFile).isFile()) {
    throw new Error(`Preview image not found: ${filename}`);
  }

  if (!imageFiles.has(filename)) {
    const extension = path.extname(filename).toLowerCase();
    const allowedExtensions = [
      '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'
    ];

    if (!allowedExtensions.includes(extension)) {
      throw new Error(`Unsupported preview image: ${filename}`);
    }

    const slot = `preview-${imageFiles.size + 1}${extension}`;
    imageFiles.set(filename, {
      sourceFile,
      slot,
      url: `/__graveyard_images/${slot}`
    });
  }

  return imageFiles.get(filename);
}

// Convert Obsidian image embeds, preserving optional display dimensions.
markdown = markdown.replace(
  /!\[\[([^\]]+)\]\]/g,
  (_, reference) => {
    const image = registerImage(reference);
    const parts = reference.split('|');
    const alt = path.parse(parts[0].trim()).name
      .replace(/[-_]/g, ' ');
    const size = (parts[1] ?? '').trim();
    const dimensions = size.match(/^([1-9]\d*)(?:x([1-9]\d*))?$/);

    if (!dimensions) return `![${alt}](${image.url})`;

    const width = dimensions[1];
    const height = dimensions[2] ? ` height="${dimensions[2]}"` : '';
    const safeAlt = alt.replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;').replace(/</g, '&lt;');

    return `<img src="${image.url}" alt="${safeAlt}" width="${width}"${height}>`;
  }
);

// Convert the featured image frontmatter.
let featuredUrl = '';

markdown = markdown.replace(
  /^(featuredImage:[ \t]*)(.+)$/m,
  (_, prefix, value) => {
    const reference = value.trim().replace(/^["']|["']$/g, '');
    if (!reference) return `${prefix}${value}`;

    const image = registerImage(reference);
    featuredUrl = image.url;
    return `${prefix}${featuredUrl}`;
  }
);

// Remove a duplicate featured image from the article body.
if (featuredUrl) {
  const boundary = markdown.match(/^---\s*\r?\n[\s\S]*?\r?\n---\s*\r?\n/);

  if (boundary) {
    const start = boundary[0].length;
    const body = markdown.slice(start);
    const firstImage = body.match(/!\[[^\]]*\]\(([^)]+)\)/);

    if (firstImage && firstImage[1].trim() === featuredUrl) {
      markdown =
        markdown.slice(0, start) +
        body.slice(0, firstImage.index) +
        body.slice(firstImage.index + firstImage[0].length);
    }
  }
}

// Prepare every replacement before changing the current preview.
fs.mkdirSync(DRAFTS, { recursive: true });
fs.mkdirSync(IMAGES, { recursive: true });

const staging = fs.mkdtempSync(path.join(GRAVEYARD, 'staging-'));

try {
  const stagedImages = path.join(staging, 'images');
  fs.mkdirSync(stagedImages);

  for (const image of imageFiles.values()) {
    fs.copyFileSync(
      image.sourceFile,
      path.join(stagedImages, image.slot)
    );
  }

  fs.writeFileSync(path.join(staging, 'preview.md'), markdown);

  // Reuse the same temporary image slots.
  for (const name of fs.readdirSync(IMAGES)) {
    if (/^preview-\d+\.(png|jpe?g|gif|webp|svg)$/i.test(name)) {
      fs.rmSync(path.join(IMAGES, name));
    }
  }

  for (const image of imageFiles.values()) {
    fs.copyFileSync(
      path.join(stagedImages, image.slot),
      path.join(IMAGES, image.slot)
    );
  }

  fs.copyFileSync(path.join(staging, 'preview.md'), PREVIEW);

  console.log(`Preview ready: ${path.basename(source)}`);
  console.log(`Images copied: ${imageFiles.size}`);
} finally {
  fs.rmSync(staging, { recursive: true, force: true });
}
