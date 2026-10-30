// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { readFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

function graveyardImages() {
  return {
    name: 'graveyardImages',
    configureServer(server) {
      server.middlewares.use('/__graveyard_identity', (req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-store');
        res.end(JSON.stringify({
          site: 'divergentjournaler',
          purpose: 'graveyard-preview'
        }));
      });

      server.middlewares.use('/__graveyard_images', async (req, res, next) => {
        try {
          const imageRoot = resolve('.graveyard/images');
          const requested = decodeURIComponent((req.url || '').split('?')[0]);
          const file = resolve(imageRoot, '.' + requested);

          if (!file.startsWith(imageRoot + sep)) {
            res.statusCode = 403;
            res.end('Forbidden');
            return;
          }

          const types = {
            '.png': 'image/png',
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.gif': 'image/gif',
            '.webp': 'image/webp',
            '.svg': 'image/svg+xml'
          };

          const ext = file.slice(file.lastIndexOf('.')).toLowerCase();
          if (!types[ext]) {
            res.statusCode = 415;
            res.end('Unsupported image type');
            return;
          }

          const data = await readFile(file);
          res.setHeader('Content-Type', types[ext]);
          res.setHeader('Cache-Control', 'no-store');
          res.end(data);
        } catch {
          next();
        }
      });
    }
  };
}
import remarkBreaks from 'remark-breaks';
import settings from './src/data/site.settings.data.json' with { type: 'json' };

export default defineConfig({
  devToolbar: { enabled: false },
  site: settings.general.siteUrl,
  integrations: [sitemap()],
  markdown: { remarkPlugins: [remarkBreaks] },
  vite: {
    plugins: [graveyardImages()]
  },
});