
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

const VAULT_ROOT = path.join(
  process.env.HOME,
  "Vaults",
  "Kaoverse"
);

const DJ_ROOT = path.join(
  VAULT_ROOT,
  "KORE",
  "SITES",
  "DIVERGENTJOURNALER"
);

const IMAGE_SOURCE = path.join(
  DJ_ROOT,
  "UPLOADS",
  "IMAGES"
);

const IMAGE_DESTINATION = path.join(
  PROJECT_ROOT,
  "public",
  "uploads",
  "images"
);

const articleImages = new Set();

function getFrontmatterValue(markdown, field) {
  const frontmatter = markdown.match(
    /^---\s*\r?\n([\s\S]*?)\r?\n---/
  );

  if (!frontmatter) {
    throw new Error("Article is missing YAML frontmatter.");
  }

  const line = frontmatter[1]
    .split(/\r?\n/)
    .find((line) => line.startsWith(`${field}:`));

  if (!line) return "";

  return line
    .slice(field.length + 1)
    .trim()
    .replace(/^["']|["']$/g, "");
}

function setFrontmatterValue(markdown, field, value) {
  const line = `${field}: ${value}`;
  const pattern = new RegExp(`^${field}:[^\\r\\n]*`, "m");

  if (pattern.test(markdown)) {
    return markdown.replace(pattern, line);
  }

  return markdown.replace(
    /^(---\s*\r?\n)/,
    `$1${line}\n`
  );
}

function convertImages(markdown) {
  return markdown.replace(
    /!\[\[([^\]]+)\]\]/g,
    (match, reference) => {
      const filename = path.basename(
        reference.split("|")[0].trim()
      );

      articleImages.add(filename);

      const source = path.join(IMAGE_SOURCE, filename);

      if (!fs.existsSync(source)) {
        throw new Error(`Image not found: ${filename}`);
      }

      fs.mkdirSync(IMAGE_DESTINATION, {
        recursive: true,
      });

      const destination = path.join(
        IMAGE_DESTINATION,
        filename
      );

      if (fs.existsSync(destination)) {
      const existing = fs.readFileSync(destination);
      const incoming = fs.readFileSync(source);

        if (!existing.equals(incoming)) {
          throw new Error(
      `Image filename conflict: ${filename}\n` +
      "An existing website image has different contents."
    );
  }
} else {
  fs.copyFileSync(source, destination);
}

      const url = `/uploads/images/${encodeURIComponent(filename)}`;

      const alt = path.parse(filename).name.replace(/[-_]/g, " ");

      return `![${alt}](${url})`;
    }
  );
}


function convertFeaturedImage(markdown) {
  return markdown.replace(
    /^(featuredImage:\s*)(.+)$/m,
    (match, prefix, value) => {
      const filename = path.basename(
        value.trim().replace(/^["']|["']$/g, "")
      );

      articleImages.add(filename);

      const source = path.join(IMAGE_SOURCE, filename);
      const destination = path.join(
        IMAGE_DESTINATION,
        filename
      );

      if (!fs.existsSync(source)) {
        throw new Error(`Featured image not found: ${filename}`);
      }

      fs.mkdirSync(IMAGE_DESTINATION, { recursive: true });

      if (fs.existsSync(destination)) {
        const existing = fs.readFileSync(destination);
        const incoming = fs.readFileSync(source);

        if (!existing.equals(incoming)) {
          throw new Error(
            `Featured image filename conflict: ${filename}`
          );
        }
      } else {
        fs.copyFileSync(source, destination);
      }

      return `${prefix}/uploads/images/${encodeURIComponent(filename)}`;
    }
  );
}

function removeDuplicateFeaturedImage(markdown) {
  const featuredMatch = markdown.match(
    /^featuredImage:\s*["']?([^"'\r\n]+)["']?\s*$/m
  );

  if (!featuredMatch) return markdown;

  const featuredUrl = featuredMatch[1].trim();

  // Only inspect the first image in the article body.
  const bodyStart = markdown.indexOf("\n---", 4);
  if (bodyStart === -1) return markdown;

  const body = markdown.slice(bodyStart + 4);

  const firstImage = body.match(
    /!\[[^\]]*\]\(([^)]+)\)/
  );

  if (!firstImage) return markdown;

  const firstImageUrl = firstImage[1].trim();

  // Never remove an image unless the URLs match.
  if (firstImageUrl !== featuredUrl) {
    return markdown;
  }

  const cleanedBody =
    body.slice(0, firstImage.index) +
    body.slice(firstImage.index + firstImage[0].length);

  return markdown.slice(0, bodyStart + 4) + cleanedBody;
}

const articleName = process.argv[2];

const mode = process.argv[3];

if (!["publish", "update"].includes(mode)) {
  throw new Error(
    'Choose "publish" or "update".'
  );
}

if (
  !articleName ||
  articleName !== path.basename(articleName) ||
  !articleName.toLowerCase().endsWith(".md")
) {
  throw new Error(
    'Provide a Markdown filename, for example: "Image Testing.md"'
  );
}

const articleFolder = mode === "publish" ? "DRAFTS" : "PUBLISHED";

const articlePath = path.join(
  DJ_ROOT,
  articleFolder,
  articleName
);

if (!fs.existsSync(articlePath)) {
  throw new Error(`Article not found: ${articlePath}`);
}

const originalMarkdown = fs.readFileSync(articlePath, "utf8");

const articleTitle = getFrontmatterValue(originalMarkdown, "title");
const articleCategory = getFrontmatterValue(originalMarkdown, "category");
const articleDate = getFrontmatterValue(originalMarkdown, "date");
const publishedSlug = getFrontmatterValue(
  originalMarkdown,
  "published-slug"
);

const publishedCategory = getFrontmatterValue(
  originalMarkdown,
  "published-category"
);

if (!articleTitle || !articleCategory || !articleDate) {
  throw new Error(
    "Article must have a title, category, and date."
  );
}

const convertedMarkdown = removeDuplicateFeaturedImage(
  convertFeaturedImage(
    convertImages(originalMarkdown)
  )
);

// Remove private Obsidian tags from the website copy.
// Keep site-tags because Astro already uses them.

const publishableMarkdown = convertedMarkdown
  .replace(
    /^tags:\s*\n(?:[ \t]+-[^\n]*\n)*/m,
    ""
  )
  .replace(
    /^published-(?:slug|category):[^\r\n]*(?:\r?\n|$)/gm,
    ""
  );

const outputDirectory = path.join(
  PROJECT_ROOT,
  "src",
  "content",
  "markdown"
);

const articleSlug = articleTitle
  .toLowerCase()
  .trim()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-|-$/g, "");

if (!articleSlug) {
  throw new Error("Cannot generate a slug from the article title.");
}

const outputFile = path.join(
  outputDirectory,
  `${articleSlug}.md`
);

const existingSlug = publishedSlug || articleSlug;

const existingFile = path.join(
  outputDirectory,
  `${existingSlug}.md`
);

fs.mkdirSync(outputDirectory, { recursive: true });

console.log("\nFeatured image conversion:");
console.log(
  publishableMarkdown.match(/^featuredImage:.*$/m)?.[0]
    ?? "No featured image found"
);

const articleExists = fs.existsSync(existingFile);

if (mode === "publish" && fs.existsSync(outputFile)) {
  throw new Error(
    "Article already exists. Use update instead."
  );
}

if (mode === "update") {
  if (!articleExists) {
    throw new Error(
      "Original article not found. Update cancelled."
    );
  }

  if (
    existingFile !== outputFile &&
    fs.existsSync(outputFile)
  ) {
    throw new Error(
      "New article URL conflicts with an existing article. Update cancelled."
    );
  }
}

let finalMarkdown = publishableMarkdown;

if (mode === "update") {
  const existingMarkdown = fs.readFileSync(existingFile, "utf8");
  const originalDate = getFrontmatterValue(existingMarkdown, "date");

  if (!originalDate) {
    throw new Error(
      "Existing article has no publication date. Update cancelled."
    );
  }

  finalMarkdown = finalMarkdown.replace(
    /^(date:\s*).+$/m,
    (_, prefix) => `${prefix}${originalDate}`
  );
}

const trackedMarkdown = setFrontmatterValue(
  setFrontmatterValue(
    originalMarkdown,
    "published-slug",
    articleSlug
  ),
  "published-category",
  articleCategory.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-")
);

const temporaryFile = `${outputFile}.tmp`;

try {
  fs.writeFileSync(temporaryFile, finalMarkdown, "utf8");
  fs.renameSync(temporaryFile, outputFile);
} finally {
  if (fs.existsSync(temporaryFile)) {
    fs.unlinkSync(temporaryFile);
  }
}

if (mode === "update" && existingFile !== outputFile) {
  console.log(
    "Renamed article written. Original retained until verification."
  );
}

console.log(
  `\n${mode === "publish" ? "Created" : "Updated"} website article:\n${outputFile}`
);
console.log("\nLocal only — nothing deployed.");

console.log(
  "\nArticle images:",
  JSON.stringify([...articleImages])
);