// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  site: 'https://themindshift.global',
  integrations: [
    sitemap({
      filter: (page) => page !== 'https://themindshift.global/writings/'
    })
  ],
  vite: {
    plugins: [tailwindcss()]
  }
});
