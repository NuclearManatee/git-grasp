import { defineConfig } from 'astro/config';
import react from '@astrojs/react';

export default defineConfig({
  site: 'https://git-grasp.cremaschi.dev',
  srcDir: './src',
  outDir: './dist',
  integrations: [react()],
  vite: {
    optimizeDeps: {
      exclude: ['@huggingface/transformers'],
    },
    ssr: {
      noExternal: ['@git-grasp/core'],
      external: ['@xterm/xterm', '@xterm/addon-fit'],
    },
  },
});
