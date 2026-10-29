// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import remarkBreaks from 'remark-breaks';
import settings from './src/data/site.settings.data.json' with { type: 'json' };

export default defineConfig({
  devToolbar: { enabled: false },
  site: settings.general.siteUrl,
  integrations: [sitemap()],
  markdown: { remarkPlugins: [remarkBreaks] },
});