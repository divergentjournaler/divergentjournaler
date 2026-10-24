
import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';

const markdown = defineCollection({
  loader: glob({
    pattern: '**/*.md',
    base: './src/content/markdown',
  }),
});

export const collections = {
  markdown,
};
