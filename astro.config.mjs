// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import settings from './src/data/site.settings.data.json' with { type: 'json' };

export default defineConfig({
  site: settings.general.siteUrl,
  integrations: [sitemap()],
});