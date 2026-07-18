import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'unit', environment: 'jsdom', include: ['test/**/*.test.ts'] } },
      {
        test: {
          name: 'browser',
          include: ['test/**/*.browser.test.tsx'],
          browser: { enabled: true, provider: 'playwright', instances: [{ browser: 'chromium' }], headless: true },
        },
      },
    ],
  },
});
