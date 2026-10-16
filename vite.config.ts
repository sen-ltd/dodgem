import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: '/portfolio/dodgem/',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  test: {
    testTimeout: 180000,
  },
});
