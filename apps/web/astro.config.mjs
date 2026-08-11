import { defineConfig } from 'astro/config';
import react from '@astrojs/react';

export default defineConfig({
  site: 'https://git-grasp.cremaschi.dev',
  srcDir: './src',
  outDir: './dist',
  integrations: [react()],
  vite: {
    // Force React into the client dep optimizer. Without this, a Vite/Astro race
    // can leave `_metadata.json` missing react-dom/client so the browser loads
    // raw CJS and islands fail with: createRoot is not a named export.
    optimizeDeps: {
      include: [
        'react',
        'react/jsx-runtime',
        'react/jsx-dev-runtime',
        'react-dom',
        'react-dom/client',
      ],
      exclude: ['@huggingface/transformers'],
    },
    resolve: {
      dedupe: ['react', 'react-dom'],
    },
    ssr: {
      noExternal: ['@git-grasp/common'],
      external: ['@xterm/xterm', '@xterm/addon-fit'],
    },
  },
});
