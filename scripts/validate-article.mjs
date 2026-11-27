import { parse } from "yaml";
import { readFileSync } from "node:fs";

const settings = JSON.parse(
  readFileSync(
    new URL("../src/data/site.settings.data.json", import.meta.url),
    "utf8"
  )
);

const validCategories = Object.keys(
  settings.navigation.categoryLabels
);

export function toSlug(value) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function isValidSlug(value) {
  return (
    typeof value === "string" &&
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
  );
}

function isValidDate(value) {
  if (typeof value !== "string") return false;

  const normalized = value.trim().replace(/\./g, "-");

  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return false;
  }

  const date = new Date(normalized + "T00:00:00Z");

  return (
    !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === normalized
  );
}

export function validateArticle(markdown) {
  const match = markdown.match(
    /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/
  );

  if (!match) {
    throw new Error("Article is missing YAML frontmatter.");
  }

  const data = parse(match[1]) ?? {};
  const errors = [];

  if (typeof data.title !== "string" || !data.title.trim()) {
    errors.push("Missing or invalid title.");
  }

  if (typeof data.category !== "string" || !data.category.trim()) {
    errors.push("Missing or invalid category.");
  } else if (!validCategories.includes(toSlug(data.category))) {
    errors.push(`Unknown primary category: ${data.category}.`);
  }

  if (!isValidDate(data.date)) {
    errors.push("Missing or invalid publication date.");
  }

  const normalizeTag = tag =>
    typeof tag === "string"
      ? tag.trim().replace(/^#+/, "").trim()
      : "";

  const internalTags = Array.isArray(data.tags)
    ? data.tags.map(normalizeTag)
    : [];

  if (!internalTags.includes("divergentjournaler")) {
    errors.push("tags must include divergentjournaler.");
  }

  const websiteTags = data["site-tags"];

  if (!Array.isArray(websiteTags) || !websiteTags.length) {
    errors.push("site-tags must contain at least one website tag.");
  } else {
    for (const tag of websiteTags) {
      if (!toSlug(normalizeTag(tag))) {
        errors.push(`Invalid website tag: ${JSON.stringify(tag)}.`);
      }
    }
  }

    for (const field of ["slug", "published-slug"]) {
    const value = data[field];

    if (
      value !== undefined &&
      value !== null &&
      value !== "" &&
      !isValidSlug(value)
    ) {
      errors.push(`Invalid ${field}: ${JSON.stringify(value)}.`);
    }
  }
  
  if (errors.length) {
    throw new Error(
      "Prepublish checks failed:\n\n" + errors.join("\n")
    );
  }

  return data;
}