import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwind from '@astrojs/tailwind';

// Phase C will set site to https://git-help.cremaschi.dev
export default defineConfig({
  srcDir: './src',
  outDir: './dist',
  integrations: [react(), tailwind({ applyBaseStyles: false })],
  vite: {
    optimizeDeps: {
      exclude: ['@huggingface/transformers'],
    },
    ssr: {
      noExternal: ['@git-help/core'],
      external: ['@xterm/xterm', '@xterm/addon-fit'],
    },
  },
});
